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
  createManualTmuxSession,
  killTmuxSessionByName,
  listMemonTmuxSessions,
  tmuxHasSession,
} from './tmux-discover'

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
