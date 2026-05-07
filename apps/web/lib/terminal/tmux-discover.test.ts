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

import { listMemonTmuxSessions, killTmuxSessionByName, tmuxHasSession } from './tmux-discover'

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

function tmuxLsReturns(stdout: string): void {
  spawnMock.mockImplementationOnce(() => {
    const proc = new FakeProc()
    setImmediate(() => {
      proc.stdout.emit('data', Buffer.from(stdout))
      proc.emit('exit', 0)
    })
    return proc
  })
}

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

beforeEach(() => {
  spawnMock.mockReset()
  lookupSessionMock.mockReset().mockReturnValue(null)
  stopSessionMock.mockReset().mockResolvedValue({ stopped: true })
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

  it('classifies old-format legacy session', async () => {
    tmuxLsReturns('memon-claude-foo-260507-103000|1700000000|1700001000\n')
    const rows = await listMemonTmuxSessions(fakeRuntime())
    expect(rows[0]?.staleReason).toBe('old-format')
    expect(rows[0]?.parsed.legacy).toBe(true)
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
