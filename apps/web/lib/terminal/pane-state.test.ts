// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'

import {
  __resetPaneStateMemoForTests,
  clearPaneStateMemo,
  computePaneState,
  getLastStateChangeAt,
  matchesAttention,
  matchesRunning,
  prunePaneStateMemoToActiveSet,
} from './pane-state'

beforeEach(() => {
  __resetPaneStateMemoForTests()
})

describe('matchesRunning', () => {
  it('returns true for any first-character in U+2800..U+28FF', () => {
    expect(matchesRunning('⠀ start of block')).toBe(true) // U+2800
    expect(matchesRunning('⠁ U+2801')).toBe(true)
    expect(matchesRunning('⠂ U+2802')).toBe(true)
    expect(matchesRunning('⠐ U+2810')).toBe(true)
    expect(matchesRunning('⠿ U+283F')).toBe(true)
    expect(matchesRunning('⣿ end of block')).toBe(true) // U+28FF
  })

  it('returns false for characters outside the Braille Patterns block', () => {
    expect(matchesRunning('✻ U+273B')).toBe(false)
    expect(matchesRunning('✳ U+2733')).toBe(false)
    expect(matchesRunning('[ . ] codex spinner')).toBe(false)
    expect(matchesRunning('plain ascii')).toBe(false)
    expect(matchesRunning('a Action Required')).toBe(false) // attention is separate
  })

  it('returns false for null and empty strings', () => {
    expect(matchesRunning(null)).toBe(false)
    expect(matchesRunning('')).toBe(false)
  })

  it('only checks the FIRST code point, not anywhere in the title', () => {
    expect(matchesRunning('start ⠐ middle')).toBe(false)
    expect(matchesRunning(' ⠐ leading space')).toBe(false)
  })
})

describe('matchesAttention', () => {
  it('returns true for case-insensitive substring match', () => {
    expect(matchesAttention('Action Required')).toBe(true)
    expect(matchesAttention('action required')).toBe(true)
    expect(matchesAttention('ACTION REQUIRED')).toBe(true)
    expect(matchesAttention('Foo Action Required bar')).toBe(true)
    expect(matchesAttention('[ . ] Action Required | project')).toBe(true)
  })

  it('returns false when substring is absent or contiguous-broken', () => {
    expect(matchesAttention('actionrequired')).toBe(false) // no space
    expect(matchesAttention('Action needed')).toBe(false)
    expect(matchesAttention('require action')).toBe(false)
    expect(matchesAttention('plain text')).toBe(false)
  })

  it('returns false for null and empty strings', () => {
    expect(matchesAttention(null)).toBe(false)
    expect(matchesAttention('')).toBe(false)
  })
})

describe('computePaneState — precedence', () => {
  const pane = (title: string | null) => ({ title, currentCommand: null, currentPath: null })

  it('idle when title is null and no memo flag', () => {
    expect(computePaneState('s1', null)).toBe('idle')
    expect(computePaneState('s2', pane(null))).toBe('idle')
    expect(computePaneState('s3', pane(''))).toBe('idle')
  })

  it('running when title matches running rule', () => {
    expect(computePaneState('s1', pane('⠐ working'))).toBe('running')
  })

  it('attention when title matches attention rule', () => {
    expect(computePaneState('s1', pane('[ . ] Action Required | proj'))).toBe('attention')
  })

  it('attention beats running when both rules match', () => {
    expect(computePaneState('s1', pane('⠐ Action Required'))).toBe('attention')
  })

  it('running sets the memo so next non-matching tick yields done', () => {
    expect(computePaneState('s1', pane('⠐ tick1 running'))).toBe('running')
    expect(computePaneState('s1', pane('idle title now'))).toBe('done')
  })

  it('done persists across consecutive non-matching ticks', () => {
    expect(computePaneState('s1', pane('⠐ running'))).toBe('running')
    expect(computePaneState('s1', pane('idle'))).toBe('done')
    expect(computePaneState('s1', pane('still idle'))).toBe('done')
    expect(computePaneState('s1', pane(null))).toBe('done')
  })

  it('attention does NOT set the running memo', () => {
    expect(computePaneState('s1', pane('Action Required'))).toBe('attention')
    expect(computePaneState('s1', pane('back to idle'))).toBe('idle')
  })

  it('running → attention → idle leaves state as done (running memo persists across attention)', () => {
    expect(computePaneState('s1', pane('⠐ running'))).toBe('running')
    expect(computePaneState('s1', pane('Action Required'))).toBe('attention')
    expect(computePaneState('s1', pane('back to idle'))).toBe('done')
  })

  it('clearPaneStateMemo flips done back to idle on next eval', () => {
    expect(computePaneState('s1', pane('⠐ running'))).toBe('running')
    expect(computePaneState('s1', pane('idle'))).toBe('done')
    clearPaneStateMemo('s1')
    expect(computePaneState('s1', pane('still idle'))).toBe('idle')
  })

  it('memo is per-sessionName — clearing one does not affect another', () => {
    computePaneState('s1', pane('⠐ running'))
    computePaneState('s2', pane('⠐ running'))
    expect(computePaneState('s1', pane('idle'))).toBe('done')
    expect(computePaneState('s2', pane('idle'))).toBe('done')
    clearPaneStateMemo('s1')
    expect(computePaneState('s1', pane('idle'))).toBe('idle')
    expect(computePaneState('s2', pane('idle'))).toBe('done')
  })
})

describe('lastStateChangeAt — surfaced by getLastStateChangeAt', () => {
  const pane = (title: string | null) => ({ title, currentCommand: null, currentPath: null })

  it('is null on first observation (no transition yet)', () => {
    computePaneState('s1', pane('⠐ running'))
    expect(getLastStateChangeAt('s1')).toBeNull()
  })

  it('stamps a timestamp on the first state transition', async () => {
    computePaneState('s1', pane('⠐ running'))
    expect(getLastStateChangeAt('s1')).toBeNull()
    // Force a clock movement so the recorded timestamp is observably > first tick.
    await new Promise((r) => setTimeout(r, 2))
    computePaneState('s1', pane('idle'))
    const t = getLastStateChangeAt('s1')
    expect(t).not.toBeNull()
    expect(Date.parse(t!)).toBeGreaterThan(0)
  })

  it('updates the timestamp on every distinct transition', async () => {
    computePaneState('s1', pane('⠐ running')) // first observation, no stamp
    await new Promise((r) => setTimeout(r, 2))
    computePaneState('s1', pane('idle')) // running → done: stamp A
    const tA = getLastStateChangeAt('s1')
    await new Promise((r) => setTimeout(r, 2))
    computePaneState('s1', pane('⠐ running')) // done → running: stamp B
    const tB = getLastStateChangeAt('s1')
    expect(tA).not.toBeNull()
    expect(tB).not.toBeNull()
    expect(Date.parse(tB!)).toBeGreaterThan(Date.parse(tA!))
  })

  it('does NOT update the timestamp when the computed state is unchanged', async () => {
    computePaneState('s1', pane('⠐ running'))
    await new Promise((r) => setTimeout(r, 2))
    computePaneState('s1', pane('idle')) // running → done: stamp A
    const tA = getLastStateChangeAt('s1')
    await new Promise((r) => setTimeout(r, 2))
    computePaneState('s1', pane('still idle')) // done → done: no transition
    expect(getLastStateChangeAt('s1')).toBe(tA)
  })

  it('clearPaneStateMemo drops the timestamp back to null', async () => {
    computePaneState('s1', pane('⠐ running'))
    await new Promise((r) => setTimeout(r, 2))
    computePaneState('s1', pane('idle'))
    expect(getLastStateChangeAt('s1')).not.toBeNull()
    clearPaneStateMemo('s1')
    expect(getLastStateChangeAt('s1')).toBeNull()
  })

  it('attention transitions also stamp the timestamp', async () => {
    computePaneState('s1', pane('idle')) // first observation as idle, no stamp
    expect(getLastStateChangeAt('s1')).toBeNull()
    await new Promise((r) => setTimeout(r, 2))
    computePaneState('s1', pane('Action Required')) // idle → attention
    const t = getLastStateChangeAt('s1')
    expect(t).not.toBeNull()
    expect(Date.parse(t!)).toBeGreaterThan(0)
  })
})

describe('prunePaneStateMemoToActiveSet', () => {
  const pane = (title: string | null) => ({ title, currentCommand: null, currentPath: null })

  it('removes memo entries whose sessionName is not in the active set', () => {
    computePaneState('keep', pane('⠐ running'))
    computePaneState('drop', pane('⠐ running'))
    // Confirm both have memo entries (next idle tick returns done).
    expect(computePaneState('keep', pane('idle'))).toBe('done')
    expect(computePaneState('drop', pane('idle'))).toBe('done')
    prunePaneStateMemoToActiveSet(new Set(['keep']))
    expect(computePaneState('keep', pane('idle'))).toBe('done') // still memoed
    expect(computePaneState('drop', pane('idle'))).toBe('idle') // pruned → fresh
  })

  it('pruning to empty set clears every memo entry', () => {
    computePaneState('a', pane('⠐ running'))
    computePaneState('b', pane('⠐ running'))
    prunePaneStateMemoToActiveSet(new Set())
    expect(computePaneState('a', pane('idle'))).toBe('idle')
    expect(computePaneState('b', pane('idle'))).toBe('idle')
  })
})
