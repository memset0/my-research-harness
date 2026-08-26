import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import {
  BackendTerminalAttachRequestSchema,
  BackendTerminalStartRequestSchema,
  BackendTmuxCreateRequestSchema,
  BackendTmuxRenameRequestSchema,
  BackendTmuxSessionResponseSchema,
  BackendTmuxSessionsResponseSchema,
  type TerminalConfig,
} from '@memon/core'
import { describe, expect, it, vi } from 'vitest'
import { LocalBackendTerminalService } from './terminal-service.js'

class FakeChild extends EventEmitter {
  killed = false
  exitCode: number | null = null
  stdout = new PassThrough()
  stderr = new PassThrough()

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
  ttydMaxConcurrent: 4,
  ttydIdleTtlMinutes: 30,
  paneInfoActivePollMs: 5_000,
  paneInfoIdlePollMs: 60_000,
  commands: { none: [], claude: ['claude'], codex: ['codex'], opencode: ['opencode'] },
}

function harness(hostId = 'host-a') {
  const sessions = new Set([
    'memon-codex-project-a--project--root',
    'memon-codex-missing--project--root',
  ])
  const calls: string[][] = []
  const execTmux = vi.fn(async (args: readonly string[]) => {
    const command = [...args]
    calls.push(command)
    if (command[0] === 'ls') {
      return [...sessions]
        .map((name, index) => `${name}|170000000${index}|170000001${index}`)
        .join('\n')
    }
    if (command[0] === 'list-panes') {
      return [...sessions]
        .map(
          (name, index) =>
            `${name}|1|1|${index === 0 ? 'codex' : 'bash'}|${index === 0 ? '⠋ working' : 'idle'}`,
        )
        .join('\n')
    }
    if (command[0] === 'has-session') {
      if (sessions.has(command[2]!)) return ''
      throw new Error('missing')
    }
    if (command[0] === 'new-session') {
      sessions.add(command[3]!)
      return ''
    }
    if (command[0] === 'rename-session') {
      sessions.delete(command[2]!)
      sessions.add(command[3]!)
      return ''
    }
    if (command[0] === 'kill-session') {
      sessions.delete(command[2]!)
      return ''
    }
    throw new Error(`unexpected tmux command ${command.join(' ')}`)
  })
  const children: FakeChild[] = []
  const service = new LocalBackendTerminalService({
    hostId,
    projects: [{ name: 'project-a', root: '/projects/a', include: [], exclude: [] }],
    terminal: TERMINAL,
    spawnProcess: vi.fn(() => {
      const child = new FakeChild()
      children.push(child)
      return child as unknown as ChildProcess
    }) as never,
    probe: async () => ({ available: true, path: '/private/ttyd' }),
    install: async () => ({ ok: true, path: '/private/ttyd', version: '1.7.7', durationMs: 1 }),
    allocatePort: async () => 7800 + children.length,
    startupGraceMs: 0,
    execTmux,
  })
  return { service, sessions, calls, children }
}

describe('LocalBackendTerminalService tmux management', () => {
  it('returns Host-qualified, path/port-free list/detail/pane/stale DTOs', async () => {
    const state = harness()
    await state.service.start(
      BackendTerminalStartRequestSchema.parse({
        project: 'project-a',
        scope: 'project',
        slug: 'root',
        agent: 'codex',
      }),
    )

    const listed = BackendTmuxSessionsResponseSchema.parse(await state.service.listTmux())
    expect(listed.sessions).toHaveLength(2)
    expect(
      listed.sessions.find(
        (session) => session.sessionName === 'memon-codex-project-a--project--root',
      ),
    ).toMatchObject({
      host: 'host-a',
      sessionName: 'memon-codex-project-a--project--root',
      liveEntry: { lastActiveAt: expect.any(String) },
      matchable: true,
      staleReason: null,
      pane: { currentCommand: 'codex', currentPath: null },
      state: 'running',
    })
    expect(
      listed.sessions.find(
        (session) => session.sessionName === 'memon-codex-missing--project--root',
      ),
    ).toMatchObject({
      host: 'host-a',
      staleReason: 'unknown-project',
      matchable: false,
    })
    expect(JSON.stringify(listed)).not.toContain('/projects/')
    expect(JSON.stringify(listed)).not.toContain('7800')
    const detail = BackendTmuxSessionResponseSchema.parse(
      await state.service.getTmux('memon-codex-project-a--project--root'),
    )
    expect(detail.row.host).toBe('host-a')
    state.service.close()
  })

  it('creates, renames, and kills exact Host sessions while synchronizing ttyd routes', async () => {
    const state = harness()
    const created = await state.service.createTmux(
      BackendTmuxCreateRequestSchema.parse({ name: 'scratch' }),
    )
    expect(created).toMatchObject({
      host: 'host-a',
      sessionName: 'memon-manual-scratch',
      alreadyExisted: false,
    })

    const active = (await state.service.start(
      BackendTerminalStartRequestSchema.parse({
        project: 'project-a',
        scope: 'project',
        slug: 'root',
        agent: 'codex',
      }),
    )) as { sessionName: string }
    const renamed = await state.service.renameTmux(
      active.sessionName,
      BackendTmuxRenameRequestSchema.parse({ newName: 'memon-codex-renamed' }),
    )
    expect(renamed).toMatchObject({ host: 'host-a', sessionName: 'memon-codex-renamed' })
    expect(state.service.target(active.sessionName)).toBeNull()
    expect(state.sessions.has('memon-codex-renamed')).toBe(true)

    await state.service.attach(
      BackendTerminalAttachRequestSchema.parse({ sessionName: 'memon-codex-renamed' }),
    )
    expect(state.service.target('memon-codex-renamed')).not.toBeNull()
    const killed = await state.service.killTmux('memon-codex-renamed')
    expect(killed).toMatchObject({ host: 'host-a', sessionName: 'memon-codex-renamed' })
    expect(state.service.target('memon-codex-renamed')).toBeNull()
    expect(state.sessions.has('memon-codex-renamed')).toBe(false)
    expect(state.calls).toContainEqual([
      'rename-session',
      '-t',
      active.sessionName,
      'memon-codex-renamed',
    ])
    expect(state.calls).toContainEqual(['kill-session', '-t', 'memon-codex-renamed'])
    state.service.close()
  })

  it('isolates identical tmux names between Backend Host services', async () => {
    const hostA = harness('host-a')
    const hostB = harness('host-b')
    await hostA.service.killTmux('memon-codex-project-a--project--root')
    expect(hostA.sessions.has('memon-codex-project-a--project--root')).toBe(false)
    expect(hostB.sessions.has('memon-codex-project-a--project--root')).toBe(true)
    hostA.service.close()
    hostB.service.close()
  })
})
