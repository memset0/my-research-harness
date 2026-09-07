import type { AddressInfo } from 'node:net'
import {
  type ActorContext,
  ActorContextSchema,
  type BackendCapabilities,
  BackendErrorResponseSchema,
  BackendShareValidationResponseSchema,
} from '@memon/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BACKEND_ACTOR_CONTEXT_HEADER } from './actor-context.js'
import {
  type BackendServerOptions,
  createBackendServer,
  MAX_BACKEND_SHARE_VALIDATION_BODY_BYTES,
} from './server.js'

const SERVICE_TOKEN_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const SERVICE_TOKEN_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const SHARE_TOKEN = 'share_token-01'
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

const openServers = new Set<ReturnType<typeof createBackendServer>>()

afterEach(async () => {
  vi.restoreAllMocks()
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
  const canonical =
    actor.role === 'owner'
      ? { role: 'owner' as const }
      : {
          role: 'viewer' as const,
          scopes: [...actor.scopes].sort((a, b) => {
            const host = a.host < b.host ? -1 : a.host > b.host ? 1 : 0
            if (host !== 0) return host
            return a.project < b.project ? -1 : a.project > b.project ? 1 : 0
          }),
        }
  return Buffer.from(JSON.stringify(canonical), 'utf8').toString('base64url')
}

async function startBackend(options: BackendServerOptions): Promise<string> {
  const server = createBackendServer(options)
  openServers.add(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
}

function options(
  hostId: string,
  serviceToken: string,
  shareValidator: NonNullable<BackendServerOptions['shareValidator']>,
): BackendServerOptions {
  return {
    hostId,
    serviceTokens: { current: serviceToken },
    capabilities: CAPABILITIES,
    revision: '0123456789abcdef',
    shareValidator,
  }
}

async function validateRequest(
  origin: string,
  project: string,
  requestOptions: {
    serviceToken?: string
    actor?: ActorContext
    rawActor?: string
    body?: string
    contentType?: string | null
    method?: string
  } = {},
): Promise<Response> {
  const headers = new Headers()
  if (requestOptions.serviceToken) {
    headers.set('authorization', `Bearer ${requestOptions.serviceToken}`)
  }
  if (requestOptions.actor) {
    headers.set(BACKEND_ACTOR_CONTEXT_HEADER, actorHeader(requestOptions.actor))
  } else if (requestOptions.rawActor) {
    headers.set(BACKEND_ACTOR_CONTEXT_HEADER, requestOptions.rawActor)
  }
  if (requestOptions.contentType !== null) {
    headers.set('content-type', requestOptions.contentType ?? 'application/json')
  }
  return fetch(`${origin}/api/backend/v1/projects/${encodeURIComponent(project)}/shares/validate`, {
    method: requestOptions.method ?? 'POST',
    headers,
    body:
      requestOptions.method === 'GET'
        ? undefined
        : (requestOptions.body ?? JSON.stringify({ token: SHARE_TOKEN })),
  })
}

describe('Backend Host-qualified share validation', () => {
  const owner = ActorContextSchema.parse({ role: 'owner' })

  it('returns only strict {valid} and never echoes or logs the share token', async () => {
    const validator = vi.fn(async (project: string, token: string) => {
      return project === 'project-x' && token === SHARE_TOKEN
    })
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const origin = await startBackend(options('host-a', SERVICE_TOKEN_A, validator))

    const valid = await validateRequest(origin, 'project-x', {
      serviceToken: SERVICE_TOKEN_A,
      actor: owner,
    })
    expect(valid.status).toBe(200)
    const validText = await valid.text()
    expect(BackendShareValidationResponseSchema.parse(JSON.parse(validText))).toEqual({
      valid: true,
    })
    expect(validText).not.toContain(SHARE_TOKEN)

    const invalid = await validateRequest(origin, 'project-x', {
      serviceToken: SERVICE_TOKEN_A,
      actor: owner,
      body: JSON.stringify({ token: 'different_share_token' }),
    })
    expect(BackendShareValidationResponseSchema.parse(await invalid.json())).toEqual({
      valid: false,
    })
    expect(validator).toHaveBeenCalledWith('project-x', SHARE_TOKEN)
    expect(consoleLog).not.toHaveBeenCalled()
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('service-authenticates before actor/body/provider work', async () => {
    const validator = vi.fn(async () => true)
    const origin = await startBackend(options('host-a', SERVICE_TOKEN_A, validator))
    const response = await validateRequest(origin, 'project-x', {
      actor: owner,
      body: JSON.stringify({ token: SHARE_TOKEN }),
    })
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toBeNull()
    expect(BackendErrorResponseSchema.parse(await response.json()).error.code).toBe('UNAUTHORIZED')
    expect(validator).not.toHaveBeenCalled()
  })

  it('requires a valid owner actor and returns viewer 403', async () => {
    const validator = vi.fn(async () => true)
    const origin = await startBackend(options('host-a', SERVICE_TOKEN_A, validator))

    const missing = await validateRequest(origin, 'project-x', {
      serviceToken: SERVICE_TOKEN_A,
    })
    expect(missing.status).toBe(400)

    const malformed = await validateRequest(origin, 'project-x', {
      serviceToken: SERVICE_TOKEN_A,
      rawActor: 'not valid!',
    })
    expect(malformed.status).toBe(400)

    const viewer = ActorContextSchema.parse({
      role: 'viewer',
      scopes: [{ host: 'host-a', project: 'project-x' }],
    })
    const forbidden = await validateRequest(origin, 'project-x', {
      serviceToken: SERVICE_TOKEN_A,
      actor: viewer,
    })
    expect(forbidden.status).toBe(403)
    expect(BackendErrorResponseSchema.parse(await forbidden.json()).error.code).toBe('FORBIDDEN')
    expect(validator).not.toHaveBeenCalled()
  })

  it.each([
    ['missing token', {}],
    ['extra absolute root', { token: SHARE_TOKEN, root: '/srv/private' }],
    ['invalid token characters', { token: 'secret with spaces' }],
  ])('rejects strict JSON with %s without echoing body data', async (_name, body) => {
    const validator = vi.fn(async () => true)
    const origin = await startBackend(options('host-a', SERVICE_TOKEN_A, validator))
    const response = await validateRequest(origin, 'project-x', {
      serviceToken: SERVICE_TOKEN_A,
      actor: owner,
      body: JSON.stringify(body),
    })
    expect(response.status).toBe(400)
    const text = await response.text()
    expect(BackendErrorResponseSchema.parse(JSON.parse(text)).error.code).toBe('BAD_REQUEST')
    expect(text).not.toContain(SHARE_TOKEN)
    expect(text).not.toContain('/srv/private')
    expect(validator).not.toHaveBeenCalled()
  })

  it('bounds the JSON body before validation', async () => {
    const validator = vi.fn(async () => true)
    const origin = await startBackend(options('host-a', SERVICE_TOKEN_A, validator))
    const response = await validateRequest(origin, 'project-x', {
      serviceToken: SERVICE_TOKEN_A,
      actor: owner,
      body: JSON.stringify({ token: 'a'.repeat(MAX_BACKEND_SHARE_VALIDATION_BODY_BYTES + 1) }),
    })
    expect(response.status).toBe(413)
    expect(BackendErrorResponseSchema.parse(await response.json()).error.code).toBe(
      'PAYLOAD_TOO_LARGE',
    )
    expect(validator).not.toHaveBeenCalled()
  })

  it('keeps equal Project names isolated behind each Backend service principal', async () => {
    const validatorA = vi.fn(async (_project: string, token: string) => token === 'share_for_a')
    const validatorB = vi.fn(async (_project: string, token: string) => token === 'share_for_b')
    const [originA, originB] = await Promise.all([
      startBackend(options('host-a', SERVICE_TOKEN_A, validatorA)),
      startBackend(options('host-b', SERVICE_TOKEN_B, validatorB)),
    ])

    const responseA = await validateRequest(originA, 'shared-project', {
      serviceToken: SERVICE_TOKEN_A,
      actor: owner,
      body: JSON.stringify({ token: 'share_for_a' }),
    })
    const responseB = await validateRequest(originB, 'shared-project', {
      serviceToken: SERVICE_TOKEN_B,
      actor: owner,
      body: JSON.stringify({ token: 'share_for_a' }),
    })
    expect(await responseA.json()).toEqual({ valid: true })
    expect(await responseB.json()).toEqual({ valid: false })
    expect(validatorA).toHaveBeenCalledWith('shared-project', 'share_for_a')
    expect(validatorB).toHaveBeenCalledWith('shared-project', 'share_for_a')
  })

  it('redacts provider failures', async () => {
    const origin = await startBackend(
      options('host-a', SERVICE_TOKEN_A, async () => {
        throw new Error(`private validation token ${SHARE_TOKEN}`)
      }),
    )
    const response = await validateRequest(origin, 'project-x', {
      serviceToken: SERVICE_TOKEN_A,
      actor: owner,
    })
    expect(response.status).toBe(503)
    const text = await response.text()
    expect(text).not.toContain(SHARE_TOKEN)
    expect(BackendErrorResponseSchema.parse(JSON.parse(text)).error.code).toBe('UNAVAILABLE')
  })
})
