import { request as httpRequest, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  type ActorContext,
  ActorContextSchema,
  type BackendCapabilities,
  BackendTerminalCheckResponseSchema,
  BackendTerminalListResponseSchema,
  BackendTerminalStartResponseSchema,
  BackendTerminalStopResponseSchema,
} from '@memon/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BACKEND_ACTOR_CONTEXT_HEADER } from './actor-context.js'
import {
  BACKEND_TERMINAL_ATTACH_ROUTE,
  BACKEND_TERMINAL_CHECK_ROUTE,
  BACKEND_TERMINAL_HERDR_ROUTE,
  BACKEND_TERMINAL_INSTALL_ROUTE,
  BACKEND_TERMINAL_LIST_ROUTE,
  BACKEND_TERMINAL_START_ROUTE,
  BACKEND_TERMINAL_STOP_ROUTE,
  createBackendServer,
} from './server.js'
import type { BackendTerminalService } from './terminal-service.js'

const TOKEN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const CAPABILITIES = {
  projects: true,
  mutations: true,
  events: true,
  logStreaming: true,
  reportAssets: true,
  wikiAssets: true,
  git: true,
  shares: true,
  tmux: true,
  terminal: true,
  slurm: false,
  herdr: false,
} satisfies BackendCapabilities
const openServers = new Set<Server>()

afterEach(async () => {
  await Promise.all(
    [...openServers].map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
        }),
    ),
  )
  openServers.clear()
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

function session(sessionName = 'memon-codex-project-a--run--run-a') {
  return {
    host: 'host-a',
    backend: 'tmux' as const,
    sessionName,
    url: `/api/terminal/proxy/host-a/${sessionName}/`,
    startedAt: '2026-08-26T19:00:00.000Z',
    lastActiveAt: '2026-08-26T19:00:01.000Z',
    agent: 'codex' as const,
    project: 'project-a',
    scope: 'run' as const,
    slug: 'run-a',
    warnings: [],
  }
}

function herdrSession() {
  return {
    ...session('memon-herdr'),
    backend: 'herdr' as const,
    url: '/api/terminal/proxy/host-a/memon-herdr/',
    agent: 'none' as const,
    scope: 'project' as const,
    slug: 'herdr',
  }
}

function fakeService(): BackendTerminalService & {
  [key: string]: ReturnType<typeof vi.fn> | unknown
} {
  const active = session()
  return {
    check: vi.fn(async () => ({ available: true, version: '1.7.7', source: 'path' })),
    install: vi.fn(async () => ({ ok: true, version: '1.7.7', durationMs: 5 })),
    start: vi.fn(async () => active),
    startHerdr: vi.fn(async () => herdrSession()),
    attach: vi.fn(async ({ sessionName }) => session(sessionName)),
    list: vi.fn(() => ({ sessions: [active] })),
    stop: vi.fn(async () => ({ stopped: true })),
    listTmux: vi.fn(async () => ({ sessions: [] })),
    getTmux: vi.fn(async () => ({})),
    createTmux: vi.fn(async () => ({})),
    renameTmux: vi.fn(async () => ({})),
    killTmux: vi.fn(async () => ({})),
    target: vi.fn(() => null),
    close: vi.fn(),
  }
}

async function startBackend(
  terminalService: BackendTerminalService,
  capabilities: BackendCapabilities = CAPABILITIES,
): Promise<number> {
  const server = createBackendServer({
    hostId: 'host-a',
    serviceTokens: { current: TOKEN },
    capabilities,
    revision: '0123456789abcdef',
    terminalService,
  })
  openServers.add(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  return (server.address() as AddressInfo).port
}

async function request(
  port: number,
  path: string,
  options: { method?: string; actor?: string; body?: unknown; token?: string } = {},
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
          authorization: `Bearer ${options.token ?? TOKEN}`,
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
          const text = Buffer.concat(chunks).toString('utf8')
          resolve({ status: response.statusCode ?? 0, body: JSON.parse(text) })
        })
      },
    )
    req.once('error', reject)
    req.end(body)
  })
}

describe('Backend terminal lifecycle routes', () => {
  it('serves every owner-only lifecycle operation without exposing a port', async () => {
    const service = fakeService()
    const port = await startBackend(service)

    const checked = await request(port, BACKEND_TERMINAL_CHECK_ROUTE, { actor: OWNER })
    expect(checked.status).toBe(200)
    expect(BackendTerminalCheckResponseSchema.parse(checked.body)).toMatchObject({
      available: true,
      version: '1.7.7',
    })
    const installed = await request(port, BACKEND_TERMINAL_INSTALL_ROUTE, {
      method: 'POST',
      actor: OWNER,
    })
    expect(installed.status).toBe(200)

    const started = await request(port, `${BACKEND_TERMINAL_START_ROUTE}?project=project-a`, {
      method: 'POST',
      actor: OWNER,
      body: { project: 'project-a', scope: 'run', slug: 'run-a', agent: 'codex' },
    })
    expect(started.status).toBe(200)
    expect(BackendTerminalStartResponseSchema.parse(started.body)).toMatchObject({
      host: 'host-a',
      sessionName: 'memon-codex-project-a--run--run-a',
    })

    const attached = await request(port, BACKEND_TERMINAL_ATTACH_ROUTE, {
      method: 'POST',
      actor: OWNER,
      body: { sessionName: 'memon-manual-same' },
    })
    expect(attached.status).toBe(200)
    expect(BackendTerminalStartResponseSchema.parse(attached.body).host).toBe('host-a')

    const listed = await request(port, BACKEND_TERMINAL_LIST_ROUTE, { actor: OWNER })
    expect(listed.status).toBe(200)
    expect(BackendTerminalListResponseSchema.parse(listed.body).sessions).toHaveLength(1)
    const stopped = await request(port, BACKEND_TERMINAL_STOP_ROUTE, {
      method: 'POST',
      actor: OWNER,
      body: { sessionName: 'memon-manual-same' },
    })
    expect(stopped.status).toBe(200)
    expect(BackendTerminalStopResponseSchema.parse(stopped.body)).toEqual({ stopped: true })
    expect(JSON.stringify([checked, installed, started, attached, listed, stopped])).not.toContain(
      '7682',
    )
  })

  it('rejects viewers, selector/body disagreement, and malformed requests before the service', async () => {
    const service = fakeService()
    const port = await startBackend(service)

    expect((await request(port, BACKEND_TERMINAL_CHECK_ROUTE, { actor: VIEWER })).status).toBe(403)
    expect(
      (
        await request(port, `${BACKEND_TERMINAL_START_ROUTE}?project=project-b`, {
          method: 'POST',
          actor: OWNER,
          body: { project: 'project-a', scope: 'run', slug: 'run-a' },
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await request(port, BACKEND_TERMINAL_ATTACH_ROUTE, {
          method: 'POST',
          actor: OWNER,
          body: { sessionName: '../foreign' },
        })
      ).status,
    ).toBe(400)
    expect(service.start).not.toHaveBeenCalled()
    expect(service.attach).not.toHaveBeenCalled()
  })

  it('routes a Host-scoped Herdr target only when the Backend advertises the capability', async () => {
    const service = fakeService()
    const port = await startBackend(service, { ...CAPABILITIES, herdr: true })
    const response = await request(port, `${BACKEND_TERMINAL_HERDR_ROUTE}?project=project-a`, {
      method: 'POST',
      actor: OWNER,
      body: { project: 'project-a', scope: 'project', slug: 'root' },
    })
    expect(response.status).toBe(200)
    expect(BackendTerminalStartResponseSchema.parse(response.body)).toMatchObject({
      host: 'host-a',
      backend: 'herdr',
      sessionName: 'memon-herdr',
    })
    expect(service.startHerdr).toHaveBeenCalledWith({
      project: 'project-a',
      scope: 'project',
      slug: 'root',
    })

    const disabled = fakeService()
    const disabledPort = await startBackend(disabled)
    expect(
      (
        await request(disabledPort, `${BACKEND_TERMINAL_HERDR_ROUTE}?project=project-a`, {
          method: 'POST',
          actor: OWNER,
          body: { project: 'project-a', scope: 'project', slug: 'root' },
        })
      ).status,
    ).toBe(409)
    expect(disabled.startHerdr).not.toHaveBeenCalled()
  })
})
