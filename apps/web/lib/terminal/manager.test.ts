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
  attachExistingSession,
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
import {
  __resetPaneStateMemoForTests,
  computePaneState,
} from './pane-state'

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
  __resetPaneStateMemoForTests()
})

afterEach(() => {
  __resetForTests()
})

function newSpawnReturnsHealthyChild(): FakeChild {
  const child = new FakeChild()
  spawnMock.mockReturnValueOnce(child)
  return child
}

const DEFAULT_COMMANDS = {
  none: [] as readonly string[],
  claude: ['claude'] as readonly string[],
  codex: ['codex'] as readonly string[],
  opencode: ['opencode'] as readonly string[],
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
    commands: DEFAULT_COMMANDS,
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

  it("project scope with sentinel slug 'root'", () => {
    expect(
      buildSessionName({ agent: 'claude', project: 'project-a', scope: 'project', slug: 'root' }),
    ).toBe('memon-claude-project-a--project--root')
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

  it('parses project-scope session name', () => {
    expect(parseSessionName('memon-claude-project-a--project--root')).toEqual({
      raw: 'memon-claude-project-a--project--root',
      agent: 'claude',
      project: 'project-a',
      scope: 'project',
      slug: 'root',
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

  it('custom claude argv replaces the default and is pushed verbatim', async () => {
    newSpawnReturnsHealthyChild()
    await startSession(
      defaultInput({
        commands: {
          ...DEFAULT_COMMANDS,
          claude: ['claude', '--dangerously-skip-permissions'],
        },
      }),
    )
    const [, args] = spawnMock.mock.calls[0]!
    // The custom argv is pushed exactly; no --continue appended because the
    // default readdir mock rejects with ENOENT (no resumable conversation).
    expect(args.slice(-2)).toEqual(['claude', '--dangerously-skip-permissions'])
    expect(args).not.toContain('--continue')
  })

  it('custom claude argv + resumable cwd appends --continue after the user argv', async () => {
    readdirMock.mockResolvedValueOnce(['session-abc.jsonl'])
    newSpawnReturnsHealthyChild()
    await startSession(
      defaultInput({
        cwd: '/tmp/run-with-history',
        commands: {
          ...DEFAULT_COMMANDS,
          claude: ['claude', '--dangerously-skip-permissions'],
        },
      }),
    )
    const [, args] = spawnMock.mock.calls[0]!
    // Resume tail goes AFTER the user's argv.
    expect(args.slice(-3)).toEqual([
      'claude',
      '--dangerously-skip-permissions',
      '--continue',
    ])
  })

  it("custom 'none' argv runs the user's command verbatim with no resume tail", async () => {
    newSpawnReturnsHealthyChild()
    await startSession(
      defaultInput({
        agent: 'none',
        commands: { ...DEFAULT_COMMANDS, none: ['zsh', '-l'] },
      }),
    )
    const [, args] = spawnMock.mock.calls[0]!
    expect(args.slice(-2)).toEqual(['zsh', '-l'])
    // Session name still uses the 'terminal' segment (the agent kind, not the argv).
    expect(args).toContain('memon-terminal-project-a--run--foo-260507-103000')
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

describe('attachExistingSession', () => {
  function attachInput(overrides: Partial<{
    sessionName: string
    maxConcurrent: number
    idleTtlMinutes: number
  }> = {}) {
    return {
      sessionName: 'memon-manual-foo',
      maxConcurrent: 16,
      idleTtlMinutes: 30,
      ...overrides,
    }
  }

  it('rejects non-memon sessionName', async () => {
    await expect(
      attachExistingSession(attachInput({ sessionName: 'not-memon' })),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('rejects sessionName with disallowed character (space)', async () => {
    await expect(
      attachExistingSession(attachInput({ sessionName: 'memon- foo' })),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('happy path: spawns ttyd with `tmux new-session -A -s <name>` (no -c, no agent CLI)', async () => {
    newSpawnReturnsHealthyChild()
    const session = await attachExistingSession(attachInput({ sessionName: 'memon-manual-myscratch' }))
    expect(spawnMock).toHaveBeenCalledTimes(1)
    const [, args] = spawnMock.mock.calls[0]!
    // The argv tail must be exactly: tmux new-session -A -s <name>
    // — no -c, no trailing agent.
    expect(args).toEqual([
      '-p',
      String(session.port),
      '-i',
      '127.0.0.1',
      '-b',
      '/api/terminal/proxy/memon-manual-myscratch',
      '--writable',
      'tmux',
      'new-session',
      '-A',
      '-s',
      'memon-manual-myscratch',
    ])
    expect(session.sessionName).toBe('memon-manual-myscratch')
  })

  it('idempotent: second call returns same entry, no extra spawn', async () => {
    newSpawnReturnsHealthyChild()
    const a = await attachExistingSession(attachInput())
    const b = await attachExistingSession(attachInput())
    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(a.sessionName).toBe(b.sessionName)
    expect(a.startedAt).toBe(b.startedAt)
  })

  it('shares serializer with startSession on the same sessionName — single ttyd', async () => {
    // Concurrent: start that resolves to sessionName memon-claude-project-a--run--foo-260507-103000
    // and an attach with that exact same sessionName. Only one ttyd should spawn.
    newSpawnReturnsHealthyChild()
    const sharedName = 'memon-claude-project-a--run--foo-260507-103000'
    const [a, b] = await Promise.all([
      startSession(defaultInput({ slug: 'foo-260507-103000' })),
      attachExistingSession(attachInput({ sessionName: sharedName })),
    ])
    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(a.sessionName).toBe(sharedName)
    expect(b.sessionName).toBe(sharedName)
    expect(a.startedAt).toBe(b.startedAt)
  })

  it('parses agent/project/scope/slug from new-format sessionName for the entry', async () => {
    newSpawnReturnsHealthyChild()
    const session = await attachExistingSession(
      attachInput({ sessionName: 'memon-claude-project-a--run--foo-260507-103000' }),
    )
    // The Entry stores parsed metadata — listSessions reflects it.
    expect(session.agent).toBe('claude')
    expect(session.project).toBe('project-a')
    expect(session.scope).toBe('run')
    expect(session.slug).toBe('foo-260507-103000')
  })

  it('falls back to sentinel agent for unparseable name (e.g. memon-manual-foo)', async () => {
    newSpawnReturnsHealthyChild()
    const session = await attachExistingSession(attachInput({ sessionName: 'memon-manual-foo' }))
    // memon-manual-foo doesn't have a recognized agent prefix → parsed.agent === null
    // → Entry uses sentinel 'none' so the ActiveSession shape stays well-typed.
    expect(session.agent).toBe('none')
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

describe('pane-state memo interaction', () => {
  const sessionName = 'memon-claude-project-a--run--foo-260507-103000'
  const runningPane = { title: '⠐ running', currentCommand: 'claude', currentPath: '/tmp' }
  const idlePane = { title: 'idle title', currentCommand: 'claude', currentPath: '/tmp' }

  function primeRunningMemo() {
    // 1) running tick sets the memo flag for sessionName.
    expect(computePaneState(sessionName, runningPane)).toBe('running')
    // 2) idle tick now returns 'done' because the flag is still set.
    expect(computePaneState(sessionName, idlePane)).toBe('done')
  }

  it('startSession (fresh spawn) clears the running memo', async () => {
    primeRunningMemo()
    newSpawnReturnsHealthyChild()
    await startSession(defaultInput())
    // After startSession committed the entry, the memo is cleared.
    expect(computePaneState(sessionName, idlePane)).toBe('idle')
  })

  it('startSession (idempotent reattach) also clears the memo', async () => {
    newSpawnReturnsHealthyChild()
    await startSession(defaultInput())
    // Now there's a healthy entry. Prime the memo by simulating a running tick.
    primeRunningMemo()
    // Second startSession call hits the idempotent-return path. It SHOULD
    // still clear the memo because the user explicitly opened the ttyd.
    await startSession(defaultInput())
    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(computePaneState(sessionName, idlePane)).toBe('idle')
  })

  it('attachExistingSession (fresh spawn) clears the running memo', async () => {
    primeRunningMemo()
    newSpawnReturnsHealthyChild()
    await attachExistingSession({
      sessionName,
      maxConcurrent: 16,
      idleTtlMinutes: 30,
    })
    expect(computePaneState(sessionName, idlePane)).toBe('idle')
  })

  it('attachExistingSession (idempotent) also clears the memo', async () => {
    newSpawnReturnsHealthyChild()
    await attachExistingSession({
      sessionName,
      maxConcurrent: 16,
      idleTtlMinutes: 30,
    })
    primeRunningMemo()
    await attachExistingSession({
      sessionName,
      maxConcurrent: 16,
      idleTtlMinutes: 30,
    })
    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(computePaneState(sessionName, idlePane)).toBe('idle')
  })

  it('stopSession does NOT clear the memo', async () => {
    newSpawnReturnsHealthyChild()
    await startSession(defaultInput())
    primeRunningMemo()
    await stopSession(sessionName)
    // Memo should still hold the flag → next idle eval still returns 'done'.
    expect(computePaneState(sessionName, idlePane)).toBe('done')
  })
})
