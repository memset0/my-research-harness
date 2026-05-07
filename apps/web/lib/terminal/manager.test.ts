// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'

// We need to fake child_process.spawn so manager.ts thinks it spawned ttyd.
const spawnMock = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ spawn: spawnMock }))

// Probe always returns "available with cached path" so startSession proceeds.
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
  listSessions,
  startSession,
  stopSession,
} from './manager'

class FakeChild extends EventEmitter {
  pid = 12345
  killed = false
  exitCode: number | null = null
  stderr = new EventEmitter()
  stdout = new EventEmitter()
  // Track signals received
  signals: NodeJS.Signals[] = []
  kill(sig?: NodeJS.Signals): boolean {
    this.signals.push(sig ?? 'SIGTERM')
    if (!this.killed) {
      this.killed = true
      // Defer the 'exit' event so callers' awaiters see the kill happen
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

describe('startSession', () => {
  it('rejects malformed runId', async () => {
    await expect(
      startSession({ runId: 'has space!', projectName: 'a' }),
    ).rejects.toBeInstanceOf(TerminalManagerError)
    await expect(
      startSession({ runId: 'has space!', projectName: 'a' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('builds the right argv: ttyd -p 7682 -i 127.0.0.1 --writable tmux new-session -A -s memon-claude-<id> claude', async () => {
    newSpawnReturnsHealthyChild()

    const session = await startSession({
      runId: 'foo-260501-100000',
      projectName: 'project-a',
    })

    expect(spawnMock).toHaveBeenCalledTimes(1)
    const [bin, args] = spawnMock.mock.calls[0]!
    expect(bin).toBe('/fake/cache/ttyd-1.7.7-x86_64')
    expect(args).toEqual([
      '-p',
      '7682',
      '-i',
      '127.0.0.1',
      '-b',
      '/api/terminal/proxy/memon-claude-foo-260501-100000',
      '--writable',
      'tmux',
      'new-session',
      '-A',
      '-s',
      'memon-claude-foo-260501-100000',
      'claude',
    ])
    expect(session.sessionName).toBe('memon-claude-foo-260501-100000')
    expect(session.port).toBe(7682)
    expect(session.agent).toBe('claude')
  })

  it("agent='none' produces a memon-term- session and no trailing tmux command", async () => {
    newSpawnReturnsHealthyChild()
    const session = await startSession({
      runId: 'foo',
      projectName: 'project-a',
      agent: 'none',
    })
    const [, args] = spawnMock.mock.calls[0]!
    expect(args).toEqual([
      '-p',
      '7682',
      '-i',
      '127.0.0.1',
      '-b',
      '/api/terminal/proxy/memon-term-foo',
      '--writable',
      'tmux',
      'new-session',
      '-A',
      '-s',
      'memon-term-foo',
    ])
    expect(session.sessionName).toBe('memon-term-foo')
    expect(session.agent).toBe('none')
  })

  it("agent='codex' produces a memon-codex- session with codex as trailing command", async () => {
    newSpawnReturnsHealthyChild()
    const session = await startSession({
      runId: 'foo',
      projectName: 'project-a',
      agent: 'codex',
    })
    const [, args] = spawnMock.mock.calls[0]!
    // ttyd's -b basePath reflects the new agent's prefix
    expect(args).toContain('/api/terminal/proxy/memon-codex-foo')
    // The tmux session name + agent are the trailing two argv elements
    expect(args.slice(-6)).toEqual([
      'tmux',
      'new-session',
      '-A',
      '-s',
      'memon-codex-foo',
      'codex',
    ])
    expect(session.sessionName).toBe('memon-codex-foo')
    expect(session.agent).toBe('codex')
  })

  it("agent='opencode' produces a memon-opencode- session with opencode as trailing command", async () => {
    newSpawnReturnsHealthyChild()
    const session = await startSession({
      runId: 'foo',
      projectName: 'project-a',
      agent: 'opencode',
    })
    const [, args] = spawnMock.mock.calls[0]!
    expect(args).toContain('/api/terminal/proxy/memon-opencode-foo')
    expect(args).toContain('opencode')
    expect(session.sessionName).toBe('memon-opencode-foo')
    expect(session.agent).toBe('opencode')
  })

  it('kills any existing ttyd before starting a new one', async () => {
    const first = newSpawnReturnsHealthyChild()
    await startSession({ runId: 'foo', projectName: 'a' })

    newSpawnReturnsHealthyChild()
    await startSession({ runId: 'bar', projectName: 'a' })

    expect(first.signals).toContain('SIGTERM')
    expect(spawnMock).toHaveBeenCalledTimes(2)
    // List should reflect the new (second) session
    const sessions = listSessions()
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.runId).toBe('bar')
  })

  it('throws TTYD_UNAVAILABLE when probe says unavailable', async () => {
    const binary = await import('./binary')
    vi.mocked(binary.probeTtyd).mockResolvedValueOnce({
      available: false,
      downloadable: true,
      suggestion: 'POST /api/terminal/install',
    })

    await expect(
      startSession({ runId: 'foo', projectName: 'a' }),
    ).rejects.toMatchObject({ code: 'TTYD_UNAVAILABLE' })
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('reports TTYD_UNAVAILABLE when ttyd exits within 500ms (early failure)', async () => {
    const child = new FakeChild()
    spawnMock.mockReturnValueOnce(child)

    // Schedule an early exit before the 500ms grace period
    setTimeout(() => {
      child.stderr.emit('data', Buffer.from('claude: command not found\n'))
      child.emit('exit', 127, null)
    }, 50)

    await expect(
      startSession({ runId: 'foo', projectName: 'a' }),
    ).rejects.toMatchObject({ code: 'TTYD_UNAVAILABLE' })
  })
})

describe('stopSession', () => {
  it('kills ttyd but does not invoke any tmux commands', async () => {
    const child = newSpawnReturnsHealthyChild()
    await startSession({ runId: 'foo-260501-100000', projectName: 'a' })

    const before = spawnMock.mock.calls.length
    const result = await stopSession('memon-claude-foo-260501-100000')
    expect(result.stopped).toBe(true)
    // No additional spawn() calls — we didn't run `tmux kill-session`
    expect(spawnMock.mock.calls.length).toBe(before)
    expect(child.signals).toContain('SIGTERM')
    expect(listSessions()).toEqual([])
  })

  it('returns stopped:false for an unknown session name', async () => {
    const result = await stopSession('memon-claude-ghost')
    expect(result).toEqual({ stopped: false })
  })
})

describe('listSessions', () => {
  it('empty by default', () => {
    expect(listSessions()).toEqual([])
  })
})

describe('concurrent startSession (React strict mode etc.)', () => {
  it('two parallel calls for the SAME runId resolve to the same session — no double spawn', async () => {
    newSpawnReturnsHealthyChild()

    const [a, b] = await Promise.all([
      startSession({ runId: 'foo', projectName: 'a' }),
      startSession({ runId: 'foo', projectName: 'a' }),
    ])

    // Only one ttyd was spawned (idempotent return for the duplicate)
    expect(spawnMock).toHaveBeenCalledTimes(1)
    // Both callers got the same session info
    expect(a.sessionName).toBe(b.sessionName)
    expect(a.startedAt).toBe(b.startedAt)
  })

  it('two parallel calls for DIFFERENT experimentIds serialize cleanly — no port race', async () => {
    const childA = new FakeChild()
    const childB = new FakeChild()
    spawnMock.mockReturnValueOnce(childA).mockReturnValueOnce(childB)

    const [a, b] = await Promise.all([
      startSession({ runId: 'foo', projectName: 'a' }),
      startSession({ runId: 'bar', projectName: 'a' }),
    ])

    // Both spawns happened, but sequenced — second only ran after first
    // finished, so the kill-then-respawn path was taken.
    expect(spawnMock).toHaveBeenCalledTimes(2)
    expect(childA.signals).toContain('SIGTERM') // first child got killed
    // The second one is the survivor
    expect(listSessions()).toHaveLength(1)
    expect(listSessions()[0]?.runId).toBe('bar')
    expect(a.runId).toBe('foo')
    expect(b.runId).toBe('bar')
  })
})
