import { request as httpRequest, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  type ActorContext,
  ActorContextSchema,
  type BackendCapabilities,
  BackendTmuxCreateResponseSchema,
  BackendTmuxKillResponseSchema,
  BackendTmuxRenameResponseSchema,
  BackendTmuxSessionResponseSchema,
  BackendTmuxSessionsResponseSchema,
} from '@memon/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BACKEND_ACTOR_CONTEXT_HEADER } from './actor-context.js'
import { BACKEND_TMUX_SESSIONS_ROUTE, createBackendServer } from './server.js'
import type { BackendTerminalService } from './terminal-service.js'

const TOKEN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const SESSION = 'memon-codex-project-a--project--root'
const CAPABILITIES = {
  projects: true,
  mutations: true,
  events: true,
  logStreaming: true,
  reportAssets: true,
  git: true,
  shares: true,
  tmux: true,
  terminal: true,
  slurm: false,
  herdr: false,
} satisfies BackendCapabilities
const servers = new Set<Server>()

afterEach(async () => {
  await Promise.all(
    [...servers].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  )
  servers.clear()
})

function actorHeader(actor: ActorContext): string {
  return Buffer.from(JSON.stringify(actor), 'utf8').toString('base64url')
}

const OWNER = actorHeader(ActorContextSchema.parse({ role: 'owner' }))
const VIEWER = actorHeader(
  ActorContextSchema.parse({
    role: 'viewer',
    scopes: [{ host: 'host-a', project: 'project-a' }],
  }),
)

function row() {
  return {
    host: 'host-a',
    sessionName: SESSION,
    parsed: {
      raw: SESSION,
      agent: 'codex' as const,
      project: 'project-a',
      scope: 'project' as const,
      slug: 'root',
      legacy: false,
    },
    liveEntry: { lastActiveAt: '2026-08-26T19:00:00.000Z' },
    tmuxCreatedAt: '2026-08-26T18:00:00.000Z',
    tmuxLastActivity: '2026-08-26T19:00:00.000Z',
    matchable: true,
    staleReason: null,
    pane: { title: 'idle', currentCommand: 'bash', currentPath: null },
    state: 'idle' as const,
    lastStateChangeAt: null,
  }
}

function service() {
  const session = row()
  return {
    check: vi.fn(async () => ({ available: true })),
    install: vi.fn(async () => ({ ok: true, version: '1.7.7', durationMs: 1 })),
    start: vi.fn(async () => ({})),
    startHerdr: vi.fn(async () => ({})),
    attach: vi.fn(async () => ({})),
    list: vi.fn(() => ({ sessions: [] })),
    stop: vi.fn(async () => ({ stopped: false })),
    listTmux: vi.fn(async () => ({ sessions: [session] })),
    getTmux: vi.fn(async () => ({ row: session })),
    createTmux: vi.fn(async () => ({
      ok: true,
      host: 'host-a',
      sessionName: 'memon-manual-scratch',
      alreadyExisted: false,
    })),
    renameTmux: vi.fn(async () => ({
      ok: true,
      host: 'host-a',
      sessionName: 'memon-codex-renamed',
    })),
    killTmux: vi.fn(async () => ({ ok: true, host: 'host-a', sessionName: SESSION })),
    target: vi.fn(() => null),
  } satisfies BackendTerminalService
}

async function start(service: BackendTerminalService): Promise<number> {
  const server = createBackendServer({
    hostId: 'host-a',
    serviceTokens: { current: TOKEN },
    capabilities: CAPABILITIES,
    revision: '0123456789abcdef',
    terminalService: service,
  })
  servers.add(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  return (server.address() as AddressInfo).port
}

async function request(
  port: number,
  path: string,
  options: { method?: string; actor?: string; body?: unknown } = {},
): Promise<{ status: number; body: unknown }> {
  const body = options.body === undefined ? null : JSON.stringify(options.body)
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        method: options.method ?? 'GET',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          ...(options.actor ? { [BACKEND_ACTOR_CONTEXT_HEADER]: options.actor } : {}),
          ...(body === null
            ? {}
            : {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(body),
              }),
        },
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.once('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            body: JSON.parse(Buffer.concat(chunks).toString()),
          })
        })
      },
    )
    req.once('error', reject)
    req.end(body)
  })
}

describe('Backend tmux routes', () => {
  it('serves Host-qualified list/detail/create/rename/kill without port or cwd', async () => {
    const terminalService = service()
    const port = await start(terminalService)
    const listed = await request(port, BACKEND_TMUX_SESSIONS_ROUTE, { actor: OWNER })
    const detailed = await request(port, `${BACKEND_TMUX_SESSIONS_ROUTE}/${SESSION}`, {
      actor: OWNER,
    })
    const created = await request(port, BACKEND_TMUX_SESSIONS_ROUTE, {
      method: 'POST',
      actor: OWNER,
      body: { name: 'scratch' },
    })
    const renamed = await request(port, `${BACKEND_TMUX_SESSIONS_ROUTE}/${SESSION}/rename`, {
      method: 'POST',
      actor: OWNER,
      body: { newName: 'memon-codex-renamed' },
    })
    const killed = await request(port, `${BACKEND_TMUX_SESSIONS_ROUTE}/${SESSION}`, {
      method: 'DELETE',
      actor: OWNER,
    })

    expect(BackendTmuxSessionsResponseSchema.parse(listed.body).sessions).toHaveLength(1)
    expect(BackendTmuxSessionResponseSchema.parse(detailed.body).row.host).toBe('host-a')
    expect(BackendTmuxCreateResponseSchema.parse(created.body).host).toBe('host-a')
    expect(BackendTmuxRenameResponseSchema.parse(renamed.body).sessionName).toBe(
      'memon-codex-renamed',
    )
    expect(BackendTmuxKillResponseSchema.parse(killed.body)).toMatchObject({ host: 'host-a' })
    expect(JSON.stringify([listed, detailed, created, renamed, killed])).not.toContain('7800')
    expect(JSON.stringify([listed, detailed, created, renamed, killed])).not.toContain('/projects/')
  })

  it('keeps all routes owner-only and rejects ambiguous path spellings before providers', async () => {
    const terminalService = service()
    const port = await start(terminalService)
    expect((await request(port, BACKEND_TMUX_SESSIONS_ROUTE, { actor: VIEWER })).status).toBe(403)
    expect(
      (
        await request(port, `${BACKEND_TMUX_SESSIONS_ROUTE}/${SESSION}`, {
          method: 'DELETE',
          actor: VIEWER,
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await request(port, `${BACKEND_TMUX_SESSIONS_ROUTE}/memon-good%2Fforeign`, {
          actor: OWNER,
        })
      ).status,
    ).toBe(404)
    expect(terminalService.killTmux).not.toHaveBeenCalled()
  })
})
