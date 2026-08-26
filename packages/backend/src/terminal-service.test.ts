import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import {
  BackendTerminalAttachRequestSchema,
  BackendTerminalStartRequestSchema,
  type TerminalConfig,
} from '@memon/core'
import { describe, expect, it, vi } from 'vitest'
import { LocalBackendTerminalService } from './terminal-service.js'

class FakeChild extends EventEmitter {
  killed = false
  exitCode: number | null = null
  stderr = new PassThrough()
  stdout = new PassThrough()

  kill(): boolean {
    if (this.killed) return false
    this.killed = true
    queueMicrotask(() => {
      this.exitCode = 0
      this.emit('exit', 0, null)
    })
    return true
  }
}

const TERMINAL: TerminalConfig = {
  tmuxEnabled: true,
  ttydMaxConcurrent: 2,
  ttydIdleTtlMinutes: 1,
  paneInfoActivePollMs: 5_000,
  paneInfoIdlePollMs: 60_000,
  commands: {
    none: [],
    claude: ['claude'],
    codex: ['codex'],
    opencode: ['opencode'],
  },
}

function harness(hostId = 'host-a') {
  let now = Date.parse('2026-08-26T19:00:00.000Z')
  let nextPort = 7800
  const children: FakeChild[] = []
  const spawnProcess = vi.fn(() => {
    const child = new FakeChild()
    children.push(child)
    return child as unknown as ChildProcess
  })
  const service = new LocalBackendTerminalService({
    hostId,
    projects: [{ name: 'project-a', root: '/projects/a', include: [], exclude: [] }],
    terminal: TERMINAL,
    now: () => now,
    spawnProcess: spawnProcess as never,
    probe: async () => ({
      available: true,
      version: '1.7.7',
      source: 'path',
      path: '/private/bin/ttyd',
    }),
    install: async () => ({
      ok: true,
      version: '1.7.7',
      path: '/private/cache/ttyd',
      durationMs: 4,
    }),
    allocatePort: async () => nextPort++,
    startupGraceMs: 0,
    idleCheckIntervalMs: 60 * 60 * 1_000,
  })
  return {
    service,
    spawnProcess,
    children,
    advance(ms: number) {
      now += ms
    },
  }
}

const START = BackendTerminalStartRequestSchema.parse({
  project: 'project-a',
  scope: 'project',
  slug: 'root',
  agent: 'codex',
})

describe('LocalBackendTerminalService', () => {
  it('returns Host-qualified public state while keeping paths and ports internal', async () => {
    const state = harness()
    const checked = await state.service.check()
    const installed = await state.service.install()
    const started = (await state.service.start(START)) as Record<string, unknown>

    expect(checked).toEqual({ available: true, version: '1.7.7', source: 'path' })
    expect(installed).toEqual({ ok: true, version: '1.7.7', durationMs: 4 })
    expect(started).toMatchObject({
      host: 'host-a',
      sessionName: 'memon-codex-project-a--project--root',
      url: '/api/terminal/proxy/host-a/memon-codex-project-a--project--root/',
    })
    expect(JSON.stringify([checked, installed, started])).not.toContain('/private/')
    expect(JSON.stringify(started)).not.toContain('7800')
    expect(state.service.target('memon-codex-project-a--project--root')).toBe(
      'http://127.0.0.1:7800',
    )
    const spawnCalls = state.spawnProcess.mock.calls as unknown as Array<[string, string[]]>
    expect(spawnCalls[0]?.[1]).toContain(
      '/api/terminal/proxy/host-a/memon-codex-project-a--project--root',
    )
    state.children[0]!.exitCode = 1
    state.children[0]!.emit('exit', 1, null)
    expect(state.service.target('memon-codex-project-a--project--root')).toBeNull()
    state.service.close()
  })

  it('isolates equal session names between Host manager instances', async () => {
    const hostA = harness('host-a')
    const hostB = harness('host-b')
    const sessionA = (await hostA.service.start(START)) as { sessionName: string; url: string }
    const sessionB = (await hostB.service.start(START)) as { sessionName: string; url: string }

    expect(sessionA.sessionName).toBe(sessionB.sessionName)
    expect(sessionA.url).toContain('/host-a/')
    expect(sessionB.url).toContain('/host-b/')
    expect(hostA.service.target(sessionA.sessionName)).toBe('http://127.0.0.1:7800')
    expect(hostB.service.target(sessionB.sessionName)).toBe('http://127.0.0.1:7800')
    await hostA.service.stop(
      BackendTerminalAttachRequestSchema.parse({ sessionName: sessionA.sessionName }),
    )
    expect(hostA.service.target(sessionA.sessionName)).toBeNull()
    expect(hostB.service.target(sessionB.sessionName)).toBe('http://127.0.0.1:7800')
    hostA.service.close()
    hostB.service.close()
  })

  it('applies LRU and idle TTL cleanup to only the exact route', async () => {
    const state = harness()
    const first = (await state.service.attach(
      BackendTerminalAttachRequestSchema.parse({ sessionName: 'memon-manual-a' }),
    )) as {
      sessionName: string
    }
    state.advance(1_000)
    const second = (await state.service.attach(
      BackendTerminalAttachRequestSchema.parse({ sessionName: 'memon-manual-b' }),
    )) as {
      sessionName: string
    }
    state.service.noteWsConnect(second.sessionName)
    state.advance(1_000)
    const third = (await state.service.attach(
      BackendTerminalAttachRequestSchema.parse({ sessionName: 'memon-manual-c' }),
    )) as {
      sessionName: string
    }

    expect(state.service.target(first.sessionName)).toBeNull()
    expect(state.service.target(second.sessionName)).not.toBeNull()
    expect(state.service.target(third.sessionName)).not.toBeNull()

    state.advance(61_000)
    await state.service.cleanupExpired()
    expect(state.service.target(second.sessionName)).not.toBeNull()
    expect(state.service.target(third.sessionName)).toBeNull()
    state.service.noteWsDisconnect(second.sessionName)
    state.advance(61_000)
    await state.service.cleanupExpired()
    expect(state.service.target(second.sessionName)).toBeNull()
    state.service.close()
  })

  it('serializes different-session allocation so concurrent starts cannot share a port', async () => {
    const state = harness()
    const [first, second] = await Promise.all([
      state.service.attach(
        BackendTerminalAttachRequestSchema.parse({ sessionName: 'memon-manual-first' }),
      ),
      state.service.attach(
        BackendTerminalAttachRequestSchema.parse({ sessionName: 'memon-manual-second' }),
      ),
    ])
    const firstName = (first as { sessionName: string }).sessionName
    const secondName = (second as { sessionName: string }).sessionName
    expect(state.service.target(firstName)).toBe('http://127.0.0.1:7800')
    expect(state.service.target(secondName)).toBe('http://127.0.0.1:7801')
    state.service.close()
  })
})
