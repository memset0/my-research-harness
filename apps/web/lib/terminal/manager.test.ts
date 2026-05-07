// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'

// Fake child_process.spawn so manager.ts thinks it spawned ttyd.
const spawnMock = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ spawn: spawnMock }))

// Mock node:fs so we can control the readdir behind the resume probe.
const readdirMock = vi.hoisted(() => vi.fn())
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readdir: readdirMock,
    },
  }
})

// Probe always returns "available with cached path".
vi.mock('./binary', () => ({
  probeTtyd: vi.fn(async () => ({
    available: true,
    version: '1.7.7',
    source: 'cached',
    path: '/fake/cache/ttyd-1.7.7-x86_64',
  })),
}))

import {
  TerminalManagerError,
  __resetForTests,
  buildSessionName,
  listSessions,
  lookupSession,
  noteWsConnect,
  noteWsDisconnect,
  parseSessionName,
  startSession,
  stopSession,
  type StartSessionInput,
} from './manager'

class FakeChild extends EventEmitter {
  pid = 12345
  killed = false
  exitCode: number | null = null
  stderr = new EventEmitter()
  stdout = new EventEmitter()
  signals: NodeJS.Signals[] = []
  kill(sig?: NodeJS.Signals): boolean {
    this.signals.push(sig ?? 'SIGTERM')
    if (!this.killed) {
      this.killed = true
      setImmediate(() => {
        this.exitCode = 0
        this.emit('exit', 0, sig)
      })
    }
    return true
  }
}

beforeEach(() => {
  spawnMock.mockReset()
  readdirMock.mockReset()
  // Default: probe finds nothing (fresh agent).
  readdirMock.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
  __resetForTests()
})

afterEach(() => {
  __resetForTests()
})

function newSpawnReturnsHealthyChild(): FakeChild {
  const child = new FakeChild()
  spawnMock.mockReturnValueOnce(child)
  return child
}

function defaultInput(overrides: Partial<StartSessionInput> = {}): StartSessionInput {
  return {
    project: 'project-a',
    scope: 'run',
    slug: 'foo-260507-103000',
    agent: 'claude',
    cwd: '/tmp/run-foo',
    maxConcurrent: 16,
    idleTtlMinutes: 30,
    ...overrides,
  }
}

describe('buildSessionName', () => {
  it('renders new format with double-hyphen scope delimiter', () => {
    expect(
      buildSessionName({ agent: 'claude', project: 'project-a', scope: 'run', slug: 'foo-260507-103000' }),
    ).toBe('memon-claude-project-a--run--foo-260507-103000')
  })

  it("agent='none' becomes 'terminal' segment", () => {
    expect(
      buildSessionName({ agent: 'none', project: 'project-a', scope: 'exp', slug: 'E0042-bar' }),
    ).toBe('memon-terminal-project-a--exp--E0042-bar')
  })

  it('rejects slug containing --', () => {
    expect(() =>
      buildSessionName({ agent: 'claude', project: 'p', scope: 'run', slug: 'foo--bar' }),
    ).toThrow(TerminalManagerError)
  })

  it('rejects project with disallowed character', () => {
    expect(() =>
      buildSessionName({ agent: 'claude', project: 'bad name', scope: 'run', slug: 'foo' }),
    ).toThrow(TerminalManagerError)
  })
})

describe('parseSessionName', () => {
  it('parses new format', () => {
    expect(parseSessionName('memon-claude-project-a--run--foo-260507-103000')).toEqual({
      raw: 'memon-claude-project-a--run--foo-260507-103000',
      agent: 'claude',
      project: 'project-a',
      scope: 'run',
      slug: 'foo-260507-103000',
      legacy: false,
    })
  })

  it('parses with multi-hyphen project', () => {
    expect(parseSessionName('memon-codex-sparse-fsdp--exp--E0042-bar')).toEqual({
      raw: 'memon-codex-sparse-fsdp--exp--E0042-bar',
      agent: 'codex',
      project: 'sparse-fsdp',
      scope: 'exp',
      slug: 'E0042-bar',
      legacy: false,
    })
  })

  it("agent='terminal' segment maps to AgentKind 'none'", () => {
    expect(parseSessionName('memon-terminal-project-a--run--foo')).toMatchObject({
      agent: 'none',
      project: 'project-a',
      scope: 'run',
      slug: 'foo',
      legacy: false,
    })
  })

  it('classifies legacy format as legacy=true with no project/scope/slug', () => {
    expect(parseSessionName('memon-claude-foo-260507-103000')).toMatchObject({
      agent: 'claude',
      project: null,
      scope: null,
      slug: null,
      legacy: true,
    })
  })

  it('returns nulls for non-memon prefix', () => {
    expect(parseSessionName('something-else')).toMatchObject({ legacy: false, agent: null })
  })

  it('returns nulls for unparseable name with -- but bad scope', () => {
    expect(parseSessionName('memon-claude-p--bogus--slug')).toMatchObject({ legacy: false, agent: null })
  })
})

describe('startSession', () => {
  it('rejects slug with --', async () => {
    await expect(
      startSession(defaultInput({ slug: 'foo--bar' })),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('builds tmux argv with -c <cwd> and the new sessionName format', async () => {
    newSpawnReturnsHealthyChild()
    const session = await startSession(defaultInput())
    expect(spawnMock).toHaveBeenCalledTimes(1)
    const [bin, args] = spawnMock.mock.calls[0]!
    expect(bin).toBe('/fake/cache/ttyd-1.7.7-x86_64')
    expect(args).toEqual([
      '-p',
      String(session.port),
      '-i',
      '127.0.0.1',
      '-b',
      `/api/terminal/proxy/${session.sessionName}`,
      '--writable',
      'tmux',
      'new-session',
      '-A',
      '-s',
      'memon-claude-project-a--run--foo-260507-103000',
      '-c',
      '/tmp/run-foo',
      'claude',
    ])
    expect(session.sessionName).toBe('memon-claude-project-a--run--foo-260507-103000')
    expect(session.scope).toBe('run')
    expect(session.project).toBe('project-a')
    expect(session.agent).toBe('claude')
  })

  it("agent='none' produces a memon-terminal- session and no trailing agent CLI", async () => {
    newSpawnReturnsHealthyChild()
    const session = await startSession(defaultInput({ agent: 'none' }))
    const [, args] = spawnMock.mock.calls[0]!
    expect(args).toEqual([
      '-p',
      String(session.port),
      '-i',
      '127.0.0.1',
      '-b',
      `/api/terminal/proxy/${session.sessionName}`,
      '--writable',
      'tmux',
      'new-session',
      '-A',
      '-s',
      'memon-terminal-project-a--run--foo-260507-103000',
      '-c',
      '/tmp/run-foo',
    ])
    expect(session.sessionName).toBe('memon-terminal-project-a--run--foo-260507-103000')
  })

  it('exp scope sets cwd to project root (caller-supplied)', async () => {
    newSpawnReturnsHealthyChild()
    const session = await startSession(
      defaultInput({ scope: 'exp', slug: 'E0042-bar', cwd: '/repos/project-a' }),
    )
    const [, args] = spawnMock.mock.calls[0]!
    expect(args).toContain('/repos/project-a')
    expect(session.scope).toBe('exp')
    expect(session.sessionName).toBe('memon-claude-project-a--exp--E0042-bar')
  })

  it('idempotent: same sessionName second call returns same entry, no extra spawn', async () => {
    newSpawnReturnsHealthyChild()
    const a = await startSession(defaultInput())
    const b = await startSession(defaultInput())
    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(a.sessionName).toBe(b.sessionName)
    expect(a.startedAt).toBe(b.startedAt)
  })

  it('two parallel calls for same sessionName resolve to one ttyd', async () => {
    newSpawnReturnsHealthyChild()
    const [a, b] = await Promise.all([
      startSession(defaultInput()),
      startSession(defaultInput()),
    ])
    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(a.sessionName).toBe(b.sessionName)
  })

  it('two different sessionNames coexist on different ports', async () => {
    newSpawnReturnsHealthyChild()
    newSpawnReturnsHealthyChild()
    const a = await startSession(defaultInput({ slug: 'foo-260507-103000' }))
    const b = await startSession(defaultInput({ slug: 'bar-260507-103000' }))
    expect(spawnMock).toHaveBeenCalledTimes(2)
    expect(a.port).not.toBe(b.port)
    expect(listSessions()).toHaveLength(2)
  })

  it('LRU evicts oldest disconnected at cap', async () => {
    const childA = newSpawnReturnsHealthyChild()
    await startSession(defaultInput({ slug: 'a-260507-103000', maxConcurrent: 2 }))
    newSpawnReturnsHealthyChild()
    await startSession(defaultInput({ slug: 'b-260507-103000', maxConcurrent: 2 }))
    // both wsConnections=0; A is oldest. Opening C should evict A.
    newSpawnReturnsHealthyChild()
    await startSession(defaultInput({ slug: 'c-260507-103000', maxConcurrent: 2 }))
    expect(spawnMock).toHaveBeenCalledTimes(3)
    expect(childA.signals).toContain('SIGTERM')
    const slugs = listSessions().map((s) => s.slug).sort()
    expect(slugs).toEqual(['b-260507-103000', 'c-260507-103000'])
  })

  it('throws TTYD_UNAVAILABLE when probe says unavailable', async () => {
    const binary = await import('./binary')
    vi.mocked(binary.probeTtyd).mockResolvedValueOnce({
      available: false,
      downloadable: true,
      suggestion: 'POST /api/terminal/install',
    })
    await expect(startSession(defaultInput())).rejects.toMatchObject({ code: 'TTYD_UNAVAILABLE' })
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('reports TTYD_UNAVAILABLE when ttyd exits within 500ms', async () => {
    const child = new FakeChild()
    spawnMock.mockReturnValueOnce(child)
    setTimeout(() => {
      child.stderr.emit('data', Buffer.from('claude: command not found\n'))
      child.emit('exit', 127, null)
    }, 50)
    await expect(startSession(defaultInput())).rejects.toMatchObject({ code: 'TTYD_UNAVAILABLE' })
  })

  it('claude with resumable conversation appends --continue', async () => {
    readdirMock.mockResolvedValueOnce(['session-abc.jsonl'])
    newSpawnReturnsHealthyChild()
    await startSession(defaultInput({ cwd: '/tmp/run-with-history' }))
    const [, args] = spawnMock.mock.calls[0]!
    expect(args).toContain('--continue')
    expect(readdirMock).toHaveBeenCalled()
  })

  it('claude with no prior conversation does NOT append --continue', async () => {
    readdirMock.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    newSpawnReturnsHealthyChild()
    await startSession(defaultInput({ cwd: '/tmp/run-no-history' }))
    const [, args] = spawnMock.mock.calls[0]!
    expect(args).not.toContain('--continue')
  })

  it('agent=none never probes resume or appends --continue', async () => {
    newSpawnReturnsHealthyChild()
    await startSession(defaultInput({ agent: 'none' }))
    const [, args] = spawnMock.mock.calls[0]!
    expect(args).not.toContain('--continue')
    // probeResumeArgvTail short-circuits on agent='none' before any readdir
    expect(readdirMock).not.toHaveBeenCalled()
  })
})

describe('lookupSession + ws activity', () => {
  it('returns port + lastActiveAt for known sessionName', async () => {
    newSpawnReturnsHealthyChild()
    const s = await startSession(defaultInput())
    const looked = lookupSession(s.sessionName)
    expect(looked?.port).toBe(s.port)
    expect(typeof looked?.lastActiveAt).toBe('string')
  })

  it('returns null for unknown sessionName', () => {
    expect(lookupSession('memon-claude-nope--run--missing')).toBeNull()
  })

  it('noteWsConnect / noteWsDisconnect track wsConnections for LRU eligibility', async () => {
    newSpawnReturnsHealthyChild()
    const s = await startSession(defaultInput({ maxConcurrent: 2 }))
    noteWsConnect(s.sessionName)
    // A second sessionName at cap=2 means starting a third would need to evict.
    newSpawnReturnsHealthyChild()
    await startSession(defaultInput({ slug: 'second-260507-103000', maxConcurrent: 2 }))
    // Now starting a third should evict the disconnected one (the second),
    // not the connected one (s).
    newSpawnReturnsHealthyChild()
    await startSession(defaultInput({ slug: 'third-260507-103000', maxConcurrent: 2 }))
    const remaining = listSessions().map((x) => x.slug).sort()
    // First (s) survived because it's connected; second was evicted.
    expect(remaining).toContain(s.slug)
    expect(remaining).toContain('third-260507-103000')
    expect(remaining).not.toContain('second-260507-103000')
    noteWsDisconnect(s.sessionName)
  })
})

describe('stopSession', () => {
  it('kills ttyd but does not invoke any tmux commands', async () => {
    const child = newSpawnReturnsHealthyChild()
    const s = await startSession(defaultInput())
    const before = spawnMock.mock.calls.length
    const result = await stopSession(s.sessionName)
    expect(result.stopped).toBe(true)
    expect(spawnMock.mock.calls.length).toBe(before) // no tmux kill-session spawn
    expect(child.signals).toContain('SIGTERM')
    expect(listSessions()).toEqual([])
  })

  it('returns stopped:false for unknown sessionName', async () => {
    expect(await stopSession('memon-claude-ghost--run--x')).toEqual({ stopped: false })
  })
})

describe('listSessions', () => {
  it('empty by default', () => {
    expect(listSessions()).toEqual([])
  })
})
