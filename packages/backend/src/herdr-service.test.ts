import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { BackendHerdrStartRequestSchema, type TerminalConfig } from '@memon/core'
import { describe, expect, it, vi } from 'vitest'
import { LocalBackendTerminalService } from './terminal-service.js'

class FakeChild extends EventEmitter {
  killed = false
  exitCode: number | null = null
  stdout = new PassThrough()
  stderr = new PassThrough()
  kill(): boolean {
    this.killed = true
    queueMicrotask(() => this.emit('exit', 0, null))
    return true
  }
}

function terminal(herdr: boolean): TerminalConfig {
  return {
    tmuxEnabled: true,
    ...(herdr ? { herdr: { cli: ['/opt/herdr/bin/herdr', '--profile', 'research'] } } : {}),
    ttydMaxConcurrent: 4,
    ttydIdleTtlMinutes: 30,
    paneInfoActivePollMs: 5_000,
    paneInfoIdlePollMs: 60_000,
    commands: { none: [], claude: ['claude'], codex: ['codex'], opencode: ['opencode'] },
  }
}

function harness(hostId: string, herdr = true) {
  const child = new FakeChild()
  const spawnProcess = vi.fn(() => child as unknown as ChildProcess)
  const execHerdr = vi.fn(async () =>
    JSON.stringify({ result: { workspaces: [{ workspace_id: 'ws-1', label: 'project-a' }] } }),
  )
  const service = new LocalBackendTerminalService({
    hostId,
    projects: [{ name: 'project-a', root: '/projects/a', include: [], exclude: [] }],
    terminal: terminal(herdr),
    spawnProcess: spawnProcess as never,
    probe: async () => ({ available: true, path: '/private/ttyd' }),
    install: async () => ({ ok: true, version: '1.7.7', path: '/private/ttyd', durationMs: 1 }),
    allocatePort: async () => 7900,
    startupGraceMs: 0,
    execHerdr,
  })
  return { service, spawnProcess, execHerdr }
}

describe('LocalBackendTerminalService Herdr integration', () => {
  it('launches and focuses Herdr only on the owning Host with a Host-qualified route', async () => {
    const state = harness('host-a')
    const result = (await state.service.startHerdr(
      BackendHerdrStartRequestSchema.parse({
        project: 'project-a',
        scope: 'project',
        slug: 'root',
      }),
    )) as { host: string; sessionName: string; url: string; backend: string }

    expect(result).toMatchObject({
      host: 'host-a',
      backend: 'herdr',
      sessionName: 'memon-herdr',
      url: '/api/terminal/proxy/host-a/memon-herdr/',
    })
    const spawnCalls = state.spawnProcess.mock.calls as unknown as Array<[string, string[]]>
    expect(spawnCalls[0]?.[1]).toEqual([
      '-p',
      '7900',
      '-i',
      '127.0.0.1',
      '-b',
      '/api/terminal/proxy/host-a/memon-herdr',
      '--writable',
      '/opt/herdr/bin/herdr',
      '--profile',
      'research',
    ])
    expect(state.execHerdr).toHaveBeenCalledWith(
      ['/opt/herdr/bin/herdr', '--profile', 'research'],
      ['workspace', 'focus', 'ws-1'],
    )
    expect(state.service.target('memon-herdr')).toBe('http://127.0.0.1:7900')
    state.service.close()
  })

  it('fails locally when one Host lacks Herdr without touching another Host', async () => {
    const missing = harness('host-a', false)
    const enabled = harness('host-b', true)
    const input = BackendHerdrStartRequestSchema.parse({
      project: 'project-a',
      scope: 'project',
      slug: 'root',
    })
    await expect(missing.service.startHerdr(input)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
    expect(missing.spawnProcess).not.toHaveBeenCalled()
    await expect(enabled.service.startHerdr(input)).resolves.toMatchObject({ host: 'host-b' })
    expect(enabled.spawnProcess).toHaveBeenCalledOnce()
    missing.service.close()
    enabled.service.close()
  })

  it('creates and focuses a missing workspace at the selected Project cwd', async () => {
    const state = harness('host-a')
    state.execHerdr.mockResolvedValue(JSON.stringify({ result: { workspaces: [] } }))
    await state.service.startHerdr(
      BackendHerdrStartRequestSchema.parse({
        project: 'project-a',
        scope: 'project',
        slug: 'root',
      }),
    )
    expect(state.execHerdr).toHaveBeenCalledWith(
      ['/opt/herdr/bin/herdr', '--profile', 'research'],
      ['workspace', 'create', '--cwd', '/projects/a', '--label', 'project-a', '--focus'],
    )
    state.service.close()
  })
})
