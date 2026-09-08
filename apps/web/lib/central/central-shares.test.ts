// @vitest-environment node

import {
  BACKEND_API_MAJOR,
  type BackendCapabilities,
  type BackendMetadata,
  type CentralConfig,
  MEMON_RELEASE,
} from '@memon/core'
import { describe, expect, it, vi } from 'vitest'
import { BACKEND_ACTOR_CONTEXT_HEADER } from './backend-headers'
import { MAX_CENTRAL_SHARE_VALIDATION_RESPONSE_BYTES, validateCentralShare } from './central-shares'
import { CentralHostRegistry } from './host-registry'

const TOKEN_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const TOKEN_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const SHARE_A = 'share_for_a'
const CAPABILITIES = {
  projects: true,
  mutations: true,
  events: true,
  logStreaming: true,
  reportAssets: true,
  wikiAssets: true,
  git: true,
  shares: true,
  slurm: false,
} satisfies BackendCapabilities
const CONFIG: CentralConfig = {
  bindAddr: '127.0.0.1',
  bindPort: 3737,
  hosts: [
    {
      id: 'host-a',
      tokens: { current: TOKEN_A },
      transport: {
        kind: 'url',
        baseUrl: 'https://backend-a.example.test',
        allowInsecureHttp: false,
      },
    },
    {
      id: 'host-b',
      tokens: { current: TOKEN_B },
      transport: {
        kind: 'url',
        baseUrl: 'https://backend-b.example.test',
        allowInsecureHttp: false,
      },
    },
  ],
}

function metadata(host: string): BackendMetadata {
  return {
    host: host as BackendMetadata['host'],
    release: MEMON_RELEASE as BackendMetadata['release'],
    apiMajor: BACKEND_API_MAJOR,
    revision: '0123456789abcdef' as BackendMetadata['revision'],
    instanceEpoch: '9c64885c-6671-4eb5-9648-d03e04987464' as BackendMetadata['instanceEpoch'],
    ready: true,
    capabilities: CAPABILITIES,
  }
}

function registry(...usable: string[]): CentralHostRegistry {
  const result = new CentralHostRegistry(CONFIG)
  for (const host of usable) result.acceptMetadata(host, metadata(host))
  return result
}

describe('validateCentralShare', () => {
  it('uses the exact Host upstream, safe headers, owner actor, and strict result', async () => {
    const hostRegistry = registry('host-a', 'host-b')
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const expectedHost = url.includes('backend-a') ? 'host-a' : 'host-b'
      const headers = new Headers(init?.headers)
      expect(headers.get('authorization')).toBe(
        `Bearer ${expectedHost === 'host-a' ? TOKEN_A : TOKEN_B}`,
      )
      expect(headers.get(BACKEND_ACTOR_CONTEXT_HEADER)).toBeTruthy()
      expect(headers.has('cookie')).toBe(false)
      expect(init?.redirect).toBe('manual')
      const body = JSON.parse(String(init?.body))
      return Response.json({ valid: body.token === SHARE_A && expectedHost === 'host-a' })
    })

    await expect(
      validateCentralShare({
        registry: hostRegistry,
        host: 'host-a',
        project: 'shared-project',
        token: SHARE_A,
        fetchImpl,
      }),
    ).resolves.toBe(true)
    await expect(
      validateCentralShare({
        registry: hostRegistry,
        host: 'host-b',
        project: 'shared-project',
        token: SHARE_A,
        fetchImpl,
      }),
    ).resolves.toBe(false)
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(
      '/projects/shared-project/shares/validate',
    )
  })

  it('fails offline, unknown, and malformed targets before fetch', async () => {
    const hostRegistry = registry()
    const fetchImpl = vi.fn()
    for (const input of [
      { host: 'host-a', project: 'project-x', token: SHARE_A },
      { host: 'missing', project: 'project-x', token: SHARE_A },
      { host: 'Host-A', project: 'project-x', token: SHARE_A },
      { host: 'host-a', project: 'bad project', token: SHARE_A },
      { host: 'host-a', project: 'project-x', token: 'token with spaces' },
    ]) {
      await expect(
        validateCentralShare({ registry: hostRegistry, ...input, fetchImpl }),
      ).resolves.toBe(false)
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('maps Backend auth failure without relaying a challenge', async () => {
    const hostRegistry = registry('host-a')
    await expect(
      validateCentralShare({
        registry: hostRegistry,
        host: 'host-a',
        project: 'project-x',
        token: SHARE_A,
        fetchImpl: async () =>
          new Response('private challenge', {
            status: 401,
            headers: { 'www-authenticate': 'Bearer private' },
          }),
      }),
    ).resolves.toBe(false)
    expect(hostRegistry.getAvailability('host-a')?.state).toBe('authentication_failed')
  })

  it('rejects redirect and malformed/oversized responses without exposing token data', async () => {
    const redirectedRegistry = registry('host-a')
    const redirected = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://attacker.example.test/collect' },
        }),
    )
    await expect(
      validateCentralShare({
        registry: redirectedRegistry,
        host: 'host-a',
        project: 'project-x',
        token: SHARE_A,
        fetchImpl: redirected,
      }),
    ).resolves.toBe(false)
    expect(redirected).toHaveBeenCalledOnce()
    expect(redirectedRegistry.getAvailability('host-a')?.state).toBe('misconfigured')

    const malformedRegistry = registry('host-a')
    await expect(
      validateCentralShare({
        registry: malformedRegistry,
        host: 'host-a',
        project: 'project-x',
        token: SHARE_A,
        fetchImpl: async () => Response.json({ valid: true, token: SHARE_A }),
      }),
    ).resolves.toBe(false)
    expect(malformedRegistry.getAvailability('host-a')?.state).toBe('misconfigured')

    const oversizedRegistry = registry('host-a')
    await expect(
      validateCentralShare({
        registry: oversizedRegistry,
        host: 'host-a',
        project: 'project-x',
        token: SHARE_A,
        fetchImpl: async () =>
          new Response('{}', {
            headers: {
              'content-length': String(MAX_CENTRAL_SHARE_VALIDATION_RESPONSE_BYTES + 1),
            },
          }),
      }),
    ).resolves.toBe(false)
    expect(oversizedRegistry.getAvailability('host-a')?.state).toBe('misconfigured')
  })

  it('enforces a deadline without throwing or echoing the share token', async () => {
    const hostRegistry = registry('host-a')
    const fetchImpl = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
        }),
    )
    await expect(
      validateCentralShare({
        registry: hostRegistry,
        host: 'host-a',
        project: 'project-x',
        token: SHARE_A,
        timeoutMs: 5,
        fetchImpl,
      }),
    ).resolves.toBe(false)
    expect(hostRegistry.getAvailability('host-a')?.state).toBe('offline')
  })
})
