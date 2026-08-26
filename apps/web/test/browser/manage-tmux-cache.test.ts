// Unit tests for the pure LRU helper that backs the /manage/tmux
// right-pane TerminalView cache. Driving the full cache lifecycle (with
// useRouter + useSearchParams + iframe mounts) requires a real browser;
// the helper is the load-bearing pure logic and is exercised here.

import { describe, expect, it } from 'vitest'
import {
  applySelectionToCache,
  MANAGE_TMUX_CACHE_CAP,
} from '../../app/manage/tmux/tmux-page.client'

describe('MANAGE_TMUX_CACHE_CAP', () => {
  it('is 4 (the documented default)', () => {
    expect(MANAGE_TMUX_CACHE_CAP).toBe(4)
  })
})

describe('applySelectionToCache', () => {
  it('inserts a fresh entry when cache is empty', () => {
    const next = applySelectionToCache([], 'memon-manual-A', 4)
    expect(next.map((e) => e.sessionName)).toEqual(['memon-manual-A'])
    expect(next[0]?.lastSeenAt).toBeGreaterThan(0)
  })

  it('appends a fresh entry below cap', () => {
    const t0 = Date.now() - 1_000
    const prev = [
      { sessionName: 'A', lastSeenAt: t0 },
      { sessionName: 'B', lastSeenAt: t0 + 100 },
    ]
    const next = applySelectionToCache(prev, 'C', 4)
    expect(next.map((e) => e.sessionName)).toEqual(['A', 'B', 'C'])
    // Order: existing entries are preserved in array order; new one appended.
    expect(next[2]?.lastSeenAt).toBeGreaterThanOrEqual(t0)
  })

  it('bumps lastSeenAt on cache hit, leaves array order untouched', () => {
    const t0 = Date.now() - 5_000
    const prev = [
      { sessionName: 'A', lastSeenAt: t0 },
      { sessionName: 'B', lastSeenAt: t0 + 100 },
      { sessionName: 'C', lastSeenAt: t0 + 200 },
    ]
    const next = applySelectionToCache(prev, 'A', 4)
    expect(next.map((e) => e.sessionName)).toEqual(['A', 'B', 'C'])
    const a = next.find((e) => e.sessionName === 'A')
    expect(a?.lastSeenAt).toBeGreaterThan(t0)
    // B and C are unchanged
    expect(next.find((e) => e.sessionName === 'B')?.lastSeenAt).toBe(t0 + 100)
    expect(next.find((e) => e.sessionName === 'C')?.lastSeenAt).toBe(t0 + 200)
  })

  it('LRU-evicts the oldest non-selected entry when at cap', () => {
    const t0 = 1_000_000
    const prev = [
      { sessionName: 'A', lastSeenAt: t0 + 0 }, // oldest
      { sessionName: 'B', lastSeenAt: t0 + 100 },
      { sessionName: 'C', lastSeenAt: t0 + 200 },
      { sessionName: 'D', lastSeenAt: t0 + 300 },
    ]
    const next = applySelectionToCache(prev, 'E', 4)
    expect(next.map((e) => e.sessionName)).toEqual(['B', 'C', 'D', 'E'])
  })

  it('hit does not change cache size even when at cap', () => {
    const t0 = 1_000_000
    const prev = [
      { sessionName: 'A', lastSeenAt: t0 + 0 },
      { sessionName: 'B', lastSeenAt: t0 + 100 },
      { sessionName: 'C', lastSeenAt: t0 + 200 },
      { sessionName: 'D', lastSeenAt: t0 + 300 },
    ]
    const next = applySelectionToCache(prev, 'B', 4)
    expect(next).toHaveLength(4)
    expect(next.map((e) => e.sessionName).sort()).toEqual(['A', 'B', 'C', 'D'])
  })

  it('returns a new array (does not mutate prev)', () => {
    const prev = [{ sessionName: 'A', lastSeenAt: 1 }]
    const next = applySelectionToCache(prev, 'B', 4)
    expect(next).not.toBe(prev)
    expect(prev).toEqual([{ sessionName: 'A', lastSeenAt: 1 }])
  })

  it('respects a smaller cap', () => {
    const t0 = 1_000_000
    const prev = [
      { sessionName: 'A', lastSeenAt: t0 + 0 },
      { sessionName: 'B', lastSeenAt: t0 + 100 },
    ]
    const next = applySelectionToCache(prev, 'C', 2)
    expect(next.map((e) => e.sessionName)).toEqual(['B', 'C'])
  })

  it('keeps equal session names on different Hosts as distinct cache entries', () => {
    const hostA = applySelectionToCache([], 'memon-manual-same', 4, 'host-a')
    const both = applySelectionToCache(hostA, 'memon-manual-same', 4, 'host-b')
    expect(both).toEqual([
      expect.objectContaining({ host: 'host-a', sessionName: 'memon-manual-same' }),
      expect.objectContaining({ host: 'host-b', sessionName: 'memon-manual-same' }),
    ])
  })
})
