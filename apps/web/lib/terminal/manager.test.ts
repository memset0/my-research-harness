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
  it('rejects malformed experimentId', async () => {
    await expect(
      startSession({ experimentId: 'has space!', projectName: 'a' }),
    ).rejects.toBeInstanceOf(TerminalManagerError)
    await expect(
      startSession({ experimentId: 'has space!', projectName: 'a' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('builds the right argv: ttyd -p 7682 -i 127.0.0.1 --writable tmux new-session -A -s memon-claude-<id> claude', async () => {
    newSpawnReturnsHealthyChild()

    const session = await startSession({
      experimentId: 'foo-260501-100000',
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
  })

  it('kills any existing ttyd before starting a new one', async () => {
    const first = newSpawnReturnsHealthyChild()
    await startSession({ experimentId: 'foo', projectName: 'a' })

    newSpawnReturnsHealthyChild()
    await startSession({ experimentId: 'bar', projectName: 'a' })

    expect(first.signals).toContain('SIGTERM')
    expect(spawnMock).toHaveBeenCalledTimes(2)
    // List should reflect the new (second) session
    const sessions = listSessions()
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.experimentId).toBe('bar')
  })

  it('throws TTYD_UNAVAILABLE when probe says unavailable', async () => {
    const binary = await import('./binary')
    vi.mocked(binary.probeTtyd).mockResolvedValueOnce({
      available: false,
      downloadable: true,
      suggestion: 'POST /api/terminal/install',
    })

    await expect(
      startSession({ experimentId: 'foo', projectName: 'a' }),
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
      startSession({ experimentId: 'foo', projectName: 'a' }),
    ).rejects.toMatchObject({ code: 'TTYD_UNAVAILABLE' })
  })
})

describe('stopSession', () => {
  it('kills ttyd but does not invoke any tmux commands', async () => {
    const child = newSpawnReturnsHealthyChild()
    await startSession({ experimentId: 'foo-260501-100000', projectName: 'a' })

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
