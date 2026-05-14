// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

const spawnMock = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawn: spawnMock }
})

const lookupSessionMock = vi.hoisted(() => vi.fn())
const stopSessionMock = vi.hoisted(() => vi.fn().mockResolvedValue({ stopped: true }))
vi.mock('./manager', async () => {
  const actual = await vi.importActual<typeof import('./manager')>('./manager')
  return {
    ...actual,
    lookupSession: lookupSessionMock,
    stopSession: stopSessionMock,
  }
})

import {
  __resetPaneCacheForTests,
  createManualTmuxSession,
  getActivePaneMapCached,
  getEnrichedSession,
  killTmuxSessionByName,
  listMemonTmuxSessions,
  tmuxHasSession,
} from './tmux-discover'
import { __resetPaneStateMemoForTests } from './pane-state'

class FakeProc extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
}

interface FakeRuntimeOpts {
  projects?: { name: string; root: string }[]
  runs?: { id: string; project: string }[]
  experiments?: { id: string; project: string }[]
}

function fakeRuntime(opts: FakeRuntimeOpts = {}) {
  const runs = opts.runs ?? []
  const experiments = opts.experiments ?? []
  return {
    config: { projects: opts.projects ?? [{ name: 'project-a', root: '/repo/project-a' }] },
    index: {
      list: ({ project }: { project: string }) => runs.filter((r) => r.project === project),
    },
    experiments: new Map(experiments.map((e) => [e.id, e])),
    // biome-ignore lint/suspicious/noExplicitAny: Runtime shrunk to what classify() touches
  } as any
}

function queueTmuxResponse(stdout: string, exitCode = 0): void {
  spawnMock.mockImplementationOnce(() => {
    const proc = new FakeProc()
    setImmediate(() => {
      if (stdout.length > 0) proc.stdout.emit('data', Buffer.from(stdout))
      proc.emit('exit', exitCode)
    })
    return proc
  })
}

/**
 * Queue ONLY a `tmux ls` mock that errors. `listMemonTmuxSessions` short-
 * circuits before reaching the panes shell-out in that case, so no second
 * mock is needed.
 */
function tmuxLsErrors(): void {
  spawnMock.mockImplementationOnce(() => {
    const proc = new FakeProc()
    setImmediate(() => {
      proc.stderr.emit('data', Buffer.from('no server running\n'))
      proc.emit('exit', 1)
    })
    return proc
  })
}

/**
 * Queue a `tmux ls` mock with the given stdout, followed by an empty
 * `tmux list-panes -a` mock so the pane-enrichment shell-out resolves to
 * an empty map. Existing tests that don't care about pane data should use
 * this helper.
 */
function tmuxLsReturns(stdout: string): void {
  queueTmuxResponse(stdout)
  queueTmuxResponse('')
}

/**
 * Queue both `tmux ls` and `tmux list-panes -a` with their respective
 * stdouts. Use this when asserting pane enrichment.
 */
function tmuxLsAndPanesReturns(lsStdout: string, panesStdout: string): void {
  queueTmuxResponse(lsStdout)
  queueTmuxResponse(panesStdout)
}

beforeEach(() => {
  spawnMock.mockReset()
  lookupSessionMock.mockReset().mockReturnValue(null)
  stopSessionMock.mockReset().mockResolvedValue({ stopped: true })
  __resetPaneCacheForTests()
  __resetPaneStateMemoForTests()
})

describe('listMemonTmuxSessions', () => {
  it('returns [] when tmux ls errors (no daemon)', async () => {
    tmuxLsErrors()
    const rows = await listMemonTmuxSessions(fakeRuntime())
    expect(rows).toEqual([])
  })

  it('returns [] when no memon-* sessions on host', async () => {
    tmuxLsReturns('other-session|1700000000|1700000010\nlol|1700000020|1700000020\n')
    const rows = await listMemonTmuxSessions(fakeRuntime())
    expect(rows).toEqual([])
  })

  it('classifies a matchable run row', async () => {
    tmuxLsReturns('memon-claude-project-a--run--foo-260507-103000|1700000000|1700001000\n')
    const rows = await listMemonTmuxSessions(
      fakeRuntime({
        projects: [{ name: 'project-a', root: '/repo/project-a' }],
        runs: [{ id: 'foo-260507-103000', project: 'project-a' }],
      }),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      sessionName: 'memon-claude-project-a--run--foo-260507-103000',
      matchable: true,
      staleReason: null,
      parsed: { agent: 'claude', project: 'project-a', scope: 'run', slug: 'foo-260507-103000' },
    })
  })

  it('classifies a matchable exp row', async () => {
    tmuxLsReturns('memon-codex-project-a--exp--E0042-bar|1700000000|1700001000\n')
    const rows = await listMemonTmuxSessions(
      fakeRuntime({
        projects: [{ name: 'project-a', root: '/repo/project-a' }],
        experiments: [{ id: 'E0042-bar', project: 'project-a' }],
      }),
    )
    expect(rows[0]?.matchable).toBe(true)
    expect(rows[0]?.parsed.scope).toBe('exp')
  })

  it('classifies unknown-project', async () => {
    tmuxLsReturns('memon-claude-fakeproj--run--bar|1700000000|1700001000\n')
    const rows = await listMemonTmuxSessions(
      fakeRuntime({
        projects: [{ name: 'project-a', root: '/repo/project-a' }],
      }),
    )
    expect(rows[0]?.staleReason).toBe('unknown-project')
    expect(rows[0]?.matchable).toBe(false)
  })

  it('classifies unknown-target for missing run', async () => {
    tmuxLsReturns('memon-claude-project-a--run--gone-260101-000000|1700000000|1700001000\n')
    const rows = await listMemonTmuxSessions(
      fakeRuntime({
        projects: [{ name: 'project-a', root: '/repo/project-a' }],
        runs: [{ id: 'still-here-260101-000000', project: 'project-a' }],
      }),
    )
    expect(rows[0]?.staleReason).toBe('unknown-target')
  })

  it('classifies legacy-format session as manual (matchable=false, staleReason=null)', async () => {
    tmuxLsReturns('memon-claude-foo-260507-103000|1700000000|1700001000\n')
    const rows = await listMemonTmuxSessions(fakeRuntime())
    expect(rows[0]?.matchable).toBe(false)
    expect(rows[0]?.staleReason).toBeNull()
    expect(rows[0]?.parsed.legacy).toBe(true)
  })

  it('classifies arbitrary memon-manual-* name as manual (matchable=false, staleReason=null)', async () => {
    tmuxLsReturns('memon-manual-myscratch|1700000000|1700001000\n')
    const rows = await listMemonTmuxSessions(fakeRuntime())
    expect(rows[0]?.matchable).toBe(false)
    expect(rows[0]?.staleReason).toBeNull()
  })

  it('surfaces live entry from manager lookupSession', async () => {
    tmuxLsReturns('memon-claude-project-a--run--foo-260507-103000|1700000000|1700001000\n')
    lookupSessionMock.mockReturnValueOnce({
      port: 7683,
      lastActiveAt: '2026-05-07T10:00:00.000Z',
    })
    const rows = await listMemonTmuxSessions(
      fakeRuntime({
        projects: [{ name: 'project-a', root: '/repo/project-a' }],
        runs: [{ id: 'foo-260507-103000', project: 'project-a' }],
      }),
    )
    expect(rows[0]?.liveEntry).toEqual({
      port: 7683,
      lastActiveAt: '2026-05-07T10:00:00.000Z',
    })
  })

  it('sorts by tmuxLastActivity descending', async () => {
    tmuxLsReturns(
      'memon-claude-project-a--run--old-260101-000000|1700000000|1700000100\n' +
        'memon-claude-project-a--run--new-260507-000000|1700001000|1700009999\n',
    )
    const rows = await listMemonTmuxSessions(
      fakeRuntime({
        projects: [{ name: 'project-a', root: '/repo/project-a' }],
        runs: [
          { id: 'old-260101-000000', project: 'project-a' },
          { id: 'new-260507-000000', project: 'project-a' },
        ],
      }),
    )
    expect(rows.map((r) => r.parsed.slug)).toEqual(['new-260507-000000', 'old-260101-000000'])
  })
})

describe('killTmuxSessionByName', () => {
  it('rejects names that do not match the safe shape', async () => {
    await expect(killTmuxSessionByName('not-memon')).rejects.toThrow(/unsafe sessionName/)
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('shells out to tmux kill-session and clears manager entry', async () => {
    spawnMock.mockImplementationOnce(() => {
      const proc = new FakeProc()
      setImmediate(() => proc.emit('exit', 0))
      return proc
    })
    await killTmuxSessionByName('memon-claude-project-a--run--foo-260507-103000')
    expect(stopSessionMock).toHaveBeenCalledWith('memon-claude-project-a--run--foo-260507-103000')
    expect(spawnMock).toHaveBeenCalledWith(
      'tmux',
      ['kill-session', '-t', 'memon-claude-project-a--run--foo-260507-103000'],
      expect.any(Object),
    )
  })
})

describe('createManualTmuxSession', () => {
  it('happy path: spawns tmux new-session -d -s memon-manual-<name> -c <cwd>, returns alreadyExisted=false', async () => {
    // First spawn call is `tmux has-session` (returns non-zero → not exists)
    spawnMock.mockImplementationOnce(() => {
      const proc = new FakeProc()
      setImmediate(() => proc.emit('exit', 1))
      return proc
    })
    // Second spawn call is `tmux new-session -d -s ... -c ...`
    spawnMock.mockImplementationOnce(() => {
      const proc = new FakeProc()
      setImmediate(() => proc.emit('exit', 0))
      return proc
    })
    const result = await createManualTmuxSession({ name: 'foo', cwd: '/repo' })
    expect(result).toEqual({ sessionName: 'memon-manual-foo', alreadyExisted: false })
    expect(spawnMock).toHaveBeenCalledTimes(2)
    expect(spawnMock).toHaveBeenNthCalledWith(
      1,
      'tmux',
      ['has-session', '-t', 'memon-manual-foo'],
      expect.any(Object),
    )
    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      'tmux',
      ['new-session', '-d', '-s', 'memon-manual-foo', '-c', '/repo'],
      expect.any(Object),
    )
  })

  it('idempotent: returns alreadyExisted=true and skips new-session when has-session exits 0', async () => {
    // has-session returns 0 → already exists; new-session must NOT be called
    spawnMock.mockImplementationOnce(() => {
      const proc = new FakeProc()
      setImmediate(() => proc.emit('exit', 0))
      return proc
    })
    const result = await createManualTmuxSession({ name: 'foo', cwd: '/repo' })
    expect(result.alreadyExisted).toBe(true)
    // Only one spawn call: has-session. No new-session.
    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(spawnMock).toHaveBeenCalledWith(
      'tmux',
      ['has-session', '-t', 'memon-manual-foo'],
      expect.any(Object),
    )
  })

  it('rejects empty name', async () => {
    await expect(createManualTmuxSession({ name: '' })).rejects.toThrow(/name is required/)
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('rejects name containing --', async () => {
    await expect(createManualTmuxSession({ name: 'foo--bar' })).rejects.toThrow(/--/)
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('rejects name starting with memon-', async () => {
    await expect(createManualTmuxSession({ name: 'memon-foo' })).rejects.toThrow(/memon-/)
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('rejects name with disallowed character (space)', async () => {
    await expect(createManualTmuxSession({ name: 'foo bar' })).rejects.toThrow()
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('rejects name with disallowed character (slash)', async () => {
    await expect(createManualTmuxSession({ name: 'foo/bar' })).rejects.toThrow()
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it("defaults cwd to process.cwd() when not provided", async () => {
    const cwd = process.cwd()
    spawnMock.mockImplementationOnce(() => {
      const proc = new FakeProc()
      setImmediate(() => proc.emit('exit', 1))
      return proc
    })
    spawnMock.mockImplementationOnce(() => {
      const proc = new FakeProc()
      setImmediate(() => proc.emit('exit', 0))
      return proc
    })
    await createManualTmuxSession({ name: 'foo' })
    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      'tmux',
      ['new-session', '-d', '-s', 'memon-manual-foo', '-c', cwd],
      expect.any(Object),
    )
  })
})

describe('pane enrichment', () => {
  it('populates pane info on every row from list-panes output', async () => {
    tmuxLsAndPanesReturns(
      'memon-claude-project-a--run--foo-260507-103000|1700000000|1700001000\n',
      'memon-claude-project-a--run--foo-260507-103000|1|1|12345|claude|/repo/project-a/run-foo|✻ Claude — Building digest\n',
    )
    const rows = await listMemonTmuxSessions(
      fakeRuntime({
        projects: [{ name: 'project-a', root: '/repo/project-a' }],
        runs: [{ id: 'foo-260507-103000', project: 'project-a' }],
      }),
    )
    expect(rows[0]?.pane).toEqual({
      title: '✻ Claude — Building digest',
      currentCommand: 'claude',
      currentPath: '/repo/project-a/run-foo',
    })
  })

  it('only picks the active-window active-pane per session', async () => {
    tmuxLsAndPanesReturns(
      'memon-claude-project-a--run--foo|1700000000|1700001000\n',
      // window 0 inactive, window 1 active. pane 0 inactive, pane 1 active.
      'memon-claude-project-a--run--foo|0|1|11|bash|/tmp|w0p0-title\n' +
        'memon-claude-project-a--run--foo|1|0|22|node|/tmp|w1p0-title\n' +
        'memon-claude-project-a--run--foo|1|1|33|claude|/proj|w1p1-title\n',
    )
    const rows = await listMemonTmuxSessions(
      fakeRuntime({
        projects: [{ name: 'project-a', root: '/repo/project-a' }],
        runs: [{ id: 'foo', project: 'project-a' }],
      }),
    )
    expect(rows[0]?.pane).toEqual({
      title: 'w1p1-title',
      currentCommand: 'claude',
      currentPath: '/proj',
    })
  })

  it('preserves pane_title containing | characters', async () => {
    tmuxLsAndPanesReturns(
      'memon-manual-foo|1700000000|1700001000\n',
      'memon-manual-foo|1|1|99|bash|/tmp|a|b|c\n',
    )
    const rows = await listMemonTmuxSessions(fakeRuntime())
    expect(rows[0]?.pane?.title).toBe('a|b|c')
  })

  it('truncates pane_title over 256 chars with ellipsis suffix', async () => {
    const longTitle = 'x'.repeat(300)
    tmuxLsAndPanesReturns(
      'memon-manual-long|1700000000|1700001000\n',
      `memon-manual-long|1|1|10|bash|/tmp|${longTitle}\n`,
    )
    const rows = await listMemonTmuxSessions(fakeRuntime())
    const title = rows[0]?.pane?.title ?? ''
    // 256 source chars + 1 ellipsis = 257 total.
    expect(title.length).toBe(257)
    expect(title.endsWith('…')).toBe(true)
  })

  it('replaces newline characters in title with a space', async () => {
    // tmux's `tmux ls` output is per-line; an embedded newline would split
    // into two records. We simulate the post-tmux parse where a stray \n
    // sneaks into a single record's title-tail token by injecting it via
    // the fixture string. The parser should normalize it.
    tmuxLsAndPanesReturns(
      'memon-manual-foo|1700000000|1700001000\n',
      // Note the embedded \r\n in the title tail (last field on the line).
      // Our spec replaces \r and \n with a space.
      'memon-manual-foo|1|1|10|bash|/tmp|line1\rline2 still same record',
    )
    const rows = await listMemonTmuxSessions(fakeRuntime())
    expect(rows[0]?.pane?.title).toBe('line1 line2 still same record')
  })

  it('falls back to null pane on list-panes failure', async () => {
    queueTmuxResponse('memon-claude-project-a--run--foo|1700000000|1700001000\n')
    queueTmuxResponse('', 1) // list-panes errors
    const rows = await listMemonTmuxSessions(
      fakeRuntime({
        projects: [{ name: 'project-a', root: '/repo/project-a' }],
        runs: [{ id: 'foo', project: 'project-a' }],
      }),
    )
    expect(rows[0]?.pane).toBeNull()
  })

  it('null pane when session has no matching active pane in output', async () => {
    tmuxLsAndPanesReturns(
      'memon-manual-no-pane|1700000000|1700001000\n',
      // list-panes output has a different sessionName only
      'memon-other-session|1|1|10|bash|/tmp|other\n',
    )
    const rows = await listMemonTmuxSessions(fakeRuntime())
    expect(rows[0]?.pane).toBeNull()
  })
})

describe('getActivePaneMapCached', () => {
  it('caches across consecutive calls within TTL: one shell-out for two calls', async () => {
    queueTmuxResponse(
      'memon-claude-x--run--y|1|1|10|claude|/proj|hello\n',
    )
    const a = await getActivePaneMapCached()
    const b = await getActivePaneMapCached()
    expect(a).toBe(b) // same reference: served from cache
    expect(spawnMock).toHaveBeenCalledTimes(1)
  })

  it('shares the in-flight promise across concurrent callers', async () => {
    let resolve: (v: unknown) => void = () => {}
    spawnMock.mockImplementationOnce(() => {
      const proc = new FakeProc()
      const promise = new Promise<void>((r) => {
        resolve = () => r()
      })
      void promise.then(() => {
        proc.stdout.emit('data', Buffer.from('memon-x|1|1|10|claude|/proj|t\n'))
        proc.emit('exit', 0)
      })
      return proc
    })
    const p1 = getActivePaneMapCached()
    const p2 = getActivePaneMapCached()
    resolve(undefined)
    const [a, b] = await Promise.all([p1, p2])
    expect(a).toBe(b)
    expect(spawnMock).toHaveBeenCalledTimes(1) // only one fetch even though two callers
  })
})

describe('row.state derived from pane title', () => {
  it('idle for a row with no pane info', async () => {
    tmuxLsReturns('memon-manual-foo|1700000000|1700001000\n')
    const rows = await listMemonTmuxSessions(fakeRuntime())
    expect(rows[0]?.state).toBe('idle')
  })

  it("running for a row whose pane title starts with a Braille code point", async () => {
    tmuxLsAndPanesReturns(
      'memon-manual-foo|1700000000|1700001000\n',
      'memon-manual-foo|1|1|10|claude|/repo|⠐ ttyd-title-fetch\n',
    )
    const rows = await listMemonTmuxSessions(fakeRuntime())
    expect(rows[0]?.state).toBe('running')
  })

  it("attention for a row whose pane title contains 'Action Required'", async () => {
    tmuxLsAndPanesReturns(
      'memon-codex-x--exp--E0001|1700000000|1700001000\n',
      'memon-codex-x--exp--E0001|1|1|10|node|/repo|[ . ] Action Required | project\n',
    )
    const rows = await listMemonTmuxSessions(
      fakeRuntime({
        projects: [{ name: 'x', root: '/repo' }],
        experiments: [{ id: 'E0001', project: 'x' }],
      }),
    )
    expect(rows[0]?.state).toBe('attention')
  })

  it("attention beats running when both rules match", async () => {
    tmuxLsAndPanesReturns(
      'memon-manual-foo|1700000000|1700001000\n',
      'memon-manual-foo|1|1|10|claude|/repo|⠐ Action Required\n',
    )
    const rows = await listMemonTmuxSessions(fakeRuntime())
    expect(rows[0]?.state).toBe('attention')
  })

  it("two-tick sequence: running → done when title stops matching", async () => {
    // Tick 1: pane title matches running rule → state becomes running and memo flag is set
    tmuxLsAndPanesReturns(
      'memon-manual-foo|1700000000|1700001000\n',
      'memon-manual-foo|1|1|10|claude|/repo|⠐ working\n',
    )
    let rows = await listMemonTmuxSessions(fakeRuntime())
    expect(rows[0]?.state).toBe('running')

    // Reset cache so a new tmux ls + list-panes pair is consumed; do NOT
    // reset pane-state memo (we want to observe that the memo persists).
    __resetPaneCacheForTests()

    // Tick 2: pane title no longer matches → state falls through to done
    tmuxLsAndPanesReturns(
      'memon-manual-foo|1700000000|1700002000\n',
      'memon-manual-foo|1|1|10|claude|/repo|idle now\n',
    )
    rows = await listMemonTmuxSessions(fakeRuntime())
    expect(rows[0]?.state).toBe('done')
  })

  it("prunes the memo when a session disappears between ticks", async () => {
    // Tick 1: running session 'foo' → memo gets the flag
    tmuxLsAndPanesReturns(
      'memon-manual-foo|1700000000|1700001000\n',
      'memon-manual-foo|1|1|10|claude|/repo|⠐ working\n',
    )
    let rows = await listMemonTmuxSessions(fakeRuntime())
    expect(rows[0]?.state).toBe('running')

    __resetPaneCacheForTests()

    // Tick 2: 'foo' is gone from tmux ls — only 'bar' is present
    tmuxLsAndPanesReturns(
      'memon-manual-bar|1700000000|1700002000\n',
      'memon-manual-bar|1|1|11|claude|/repo|idle\n',
    )
    rows = await listMemonTmuxSessions(fakeRuntime())
    expect(rows.find((r) => r.sessionName === 'memon-manual-foo')).toBeUndefined()

    __resetPaneCacheForTests()

    // Tick 3: 'foo' re-appears. Because the memo was pruned in tick 2,
    // a fresh idle title yields state 'idle' (not 'done').
    tmuxLsAndPanesReturns(
      'memon-manual-foo|1700000000|1700003000\n',
      'memon-manual-foo|1|1|10|claude|/repo|idle\n',
    )
    rows = await listMemonTmuxSessions(fakeRuntime())
    expect(rows[0]?.state).toBe('idle')
  })
})

describe('getEnrichedSession', () => {
  it('returns the matching row with pane info populated', async () => {
    tmuxLsAndPanesReturns(
      'memon-manual-foo|1700000000|1700001000\n',
      'memon-manual-foo|1|1|10|bash|/repo|title-here\n',
    )
    const row = await getEnrichedSession(fakeRuntime(), 'memon-manual-foo')
    expect(row?.sessionName).toBe('memon-manual-foo')
    expect(row?.pane?.title).toBe('title-here')
  })

  it('returns null when no session matches', async () => {
    tmuxLsAndPanesReturns(
      'memon-manual-other|1700000000|1700001000\n',
      'memon-manual-other|1|1|10|bash|/tmp|whatever\n',
    )
    const row = await getEnrichedSession(fakeRuntime(), 'memon-manual-missing')
    expect(row).toBeNull()
  })

  it('returns null when tmux ls errors', async () => {
    tmuxLsErrors()
    const row = await getEnrichedSession(fakeRuntime(), 'memon-manual-anything')
    expect(row).toBeNull()
  })
})

describe('tmuxHasSession', () => {
  it('returns true on exit code 0', async () => {
    spawnMock.mockImplementationOnce(() => {
      const proc = new FakeProc()
      setImmediate(() => proc.emit('exit', 0))
      return proc
    })
    expect(await tmuxHasSession('memon-claude-x--run--y')).toBe(true)
  })

  it('returns false on non-zero exit code', async () => {
    spawnMock.mockImplementationOnce(() => {
      const proc = new FakeProc()
      setImmediate(() => proc.emit('exit', 1))
      return proc
    })
    expect(await tmuxHasSession('memon-claude-x--run--y')).toBe(false)
  })

  it('returns false for non-memon name without invoking tmux', async () => {
    expect(await tmuxHasSession('something-else')).toBe(false)
    expect(spawnMock).not.toHaveBeenCalled()
  })
})
