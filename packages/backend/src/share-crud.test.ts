import type { AddressInfo } from 'node:net'
import {
  type ActorContext,
  ActorContextSchema,
  type BackendCapabilities,
  BackendErrorResponseSchema,
  BackendShareCreateResponseSchema,
  BackendShareListResponseSchema,
  BackendShareRevokeResponseSchema,
} from '@memon/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BACKEND_ACTOR_CONTEXT_HEADER } from './actor-context.js'
import { type BackendServerOptions, createBackendServer } from './server.js'

const SERVICE_TOKEN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
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
const RECORD = {
  id: 'shr_abcdefgh',
  token: 'share_token',
  label: 'Reviewer',
  created_at: '2026-08-26T12:00:00Z',
  expires_at: null,
}

const openServers = new Set<ReturnType<typeof createBackendServer>>()
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

async function startBackend(overrides: Partial<BackendServerOptions> = {}): Promise<string> {
  const server = createBackendServer({
    hostId: 'host-a',
    serviceTokens: { current: SERVICE_TOKEN },
    capabilities: CAPABILITIES,
    revision: '0123456789abcdef',
    ...overrides,
  })
  openServers.add(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

async function request(
  origin: string,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  options: { service?: boolean; actor?: ActorContext; body?: unknown } = {},
): Promise<Response> {
  const headers = new Headers()
  if (options.service !== false) headers.set('authorization', `Bearer ${SERVICE_TOKEN}`)
  if (options.actor) headers.set(BACKEND_ACTOR_CONTEXT_HEADER, actorHeader(options.actor))
  if (method === 'POST') headers.set('content-type', 'application/json')
  return fetch(`${origin}${path}`, {
    method,
    headers,
    body: method === 'POST' ? JSON.stringify(options.body ?? {}) : undefined,
  })
}

describe('Backend share CRUD', () => {
  const owner = ActorContextSchema.parse({ role: 'owner' })
  const viewer = ActorContextSchema.parse({
    role: 'viewer',
    scopes: [{ host: 'host-a', project: 'project-x' }],
  })

  it('lists redacted/default and revealed records through the exact Project provider', async () => {
    const list = vi.fn(async () => [RECORD])
    const origin = await startBackend({ shareProviders: { list } })
    const base = '/api/backend/v1/projects/project-x/shares'

    const redacted = await request(origin, 'GET', `${base}?project=project-x`, { actor: owner })
    expect(BackendShareListResponseSchema.parse(await redacted.json())).toEqual({
      shares: [{ ...RECORD, token: '' }],
    })
    const revealed = await request(origin, 'GET', `${base}?project=project-x&reveal=true`, {
      actor: owner,
    })
    expect(BackendShareListResponseSchema.parse(await revealed.json())).toEqual({
      shares: [RECORD],
    })
    expect(list).toHaveBeenNthCalledWith(1, 'project-x', false)
    expect(list).toHaveBeenNthCalledWith(2, 'project-x', true)
  })

  it('creates a share record without accepting or returning a Backend share URL', async () => {
    const add = vi.fn(async () => RECORD)
    const origin = await startBackend({ shareProviders: { add } })
    const response = await request(
      origin,
      'POST',
      '/api/backend/v1/projects/project-x/shares?project=project-x',
      {
        actor: owner,
        body: { label: 'Reviewer', expires: '30d' },
      },
    )
    expect(response.status).toBe(201)
    const text = await response.text()
    expect(BackendShareCreateResponseSchema.parse(JSON.parse(text))).toEqual({ share: RECORD })
    expect(text).not.toContain('share_url')
    expect(text).not.toContain('backend.internal')
    expect(add).toHaveBeenCalledWith('project-x', { label: 'Reviewer', expires: '30d' })

    const invalid = await request(origin, 'POST', '/api/backend/v1/projects/project-x/shares', {
      actor: owner,
      body: { label: 'Reviewer', root: '/srv/private' },
    })
    expect(invalid.status).toBe(400)
    expect(add).toHaveBeenCalledTimes(1)
  })

  it('revokes only the exact safe share ID on the selected Project', async () => {
    const revoke = vi.fn(async () => [RECORD])
    const origin = await startBackend({ shareProviders: { revoke } })
    const response = await request(
      origin,
      'DELETE',
      '/api/backend/v1/projects/project-x/shares/shr_abcdefgh?project=project-x',
      { actor: owner },
    )
    expect(BackendShareRevokeResponseSchema.parse(await response.json())).toEqual({
      revoked: [RECORD],
    })
    expect(revoke).toHaveBeenCalledWith('project-x', 'shr_abcdefgh')
    const unsafe = await request(
      origin,
      'DELETE',
      '/api/backend/v1/projects/project-x/shares/Reviewer',
      { actor: owner },
    )
    expect(unsafe.status).toBe(404)
    expect(revoke).toHaveBeenCalledTimes(1)
  })

  it.each([
    'GET',
    'POST',
    'DELETE',
  ] as const)('requires service auth then owner actor for %s', async (method) => {
    const path =
      method === 'DELETE'
        ? '/api/backend/v1/projects/project-x/shares/shr_abcdefgh'
        : '/api/backend/v1/projects/project-x/shares'
    const origin = await startBackend()
    const anonymous = await request(origin, method, path, { service: false, actor: owner })
    expect(anonymous.status).toBe(401)
    const forbidden = await request(origin, method, path, { actor: viewer })
    expect(forbidden.status).toBe(403)
    expect(BackendErrorResponseSchema.parse(await forbidden.json()).error.code).toBe('FORBIDDEN')
  })

  it('rejects provider URL/extra fields instead of relaying them', async () => {
    const origin = await startBackend({
      shareProviders: {
        add: async () => ({ ...RECORD, share_url: 'https://backend.internal/private' }),
      },
    })
    const response = await request(origin, 'POST', '/api/backend/v1/projects/project-x/shares', {
      actor: owner,
      body: { label: 'Reviewer' },
    })
    expect(response.status).toBe(503)
    const text = await response.text()
    expect(text).not.toContain('backend.internal')
    expect(text).not.toContain('share_url')
  })
})
