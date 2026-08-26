// @vitest-environment node

import { BACKEND_API_MAJOR, type BackendCapabilities, type CentralHostConfig } from '@memon/core'
import { describe, expect, it, vi } from 'vitest'
import {
  BackendProbeError,
  MAX_BACKEND_METADATA_BYTES,
  normalizeBackendUpstream,
  probeBackendMetadata,
} from './backend-client'
import type { BackendFetch } from './backend-url'

const TOKEN = 'a'.repeat(32)
const capabilities: BackendCapabilities = {
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
}
const metadata = {
  host: 'host-a',
  release: '6.0.0',
  apiMajor: BACKEND_API_MAJOR,
  revision: '0123456789abcdef',
  instanceEpoch: '9c64885c-6671-4eb5-9648-d03e04987464',
  ready: true,
  capabilities,
}

const urlHost: CentralHostConfig = {
  id: 'host-a',
  tokens: { current: TOKEN },
  transport: {
    kind: 'url',
    baseUrl: 'https://backend.example.test',
    allowInsecureHttp: false,
  },
}

describe('normalizeBackendUpstream', () => {
  it('normalizes configured URL and SSH transports without exposing them publicly', () => {
    expect(normalizeBackendUpstream(urlHost)).toEqual({
      hostId: 'host-a',
      transport: 'url',
      baseUrl: 'https://backend.example.test',
      serviceToken: TOKEN,
    })
    expect(
      normalizeBackendUpstream({
        ...urlHost,
        transport: {
          kind: 'ssh',
          executable: 'ssh',
          target: 'tunnel@host.example.test',
          knownHostsFile: '/run/known_hosts',
          localPort: 4738,
          remoteHost: '127.0.0.1',
          remotePort: 3738,
        },
      }),
    ).toMatchObject({ transport: 'ssh', baseUrl: 'http://127.0.0.1:4738' })
  })
})

describe('probeBackendMetadata', () => {
  it('injects only service auth and returns schema-validated metadata', async () => {
    const fetchImpl = vi.fn<BackendFetch>(async (_input, init) => {
      const headers = new Headers(init?.headers)
      expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`)
      expect(headers.has('cookie')).toBe(false)
      expect(init?.redirect).toBe('manual')
      return Response.json(metadata)
    })
    await expect(
      probeBackendMetadata(normalizeBackendUpstream(urlHost), { fetchImpl }),
    ).resolves.toMatchObject({ host: 'host-a', release: '6.0.0' })
  })

  it.each([
    [401, 'authentication_failed'],
    [403, 'authentication_failed'],
    [404, 'misconfigured'],
    [503, 'offline'],
  ] as const)('maps HTTP %s to %s', async (status, state) => {
    const fetchImpl: BackendFetch = async () => new Response(null, { status })
    await expect(
      probeBackendMetadata(normalizeBackendUpstream(urlHost), { fetchImpl }),
    ).rejects.toMatchObject({ state })
  })

  it('rejects invalid metadata without echoing its body', async () => {
    const fetchImpl: BackendFetch = async () => Response.json({ token: TOKEN, host: 'wrong' })
    const error = await probeBackendMetadata(normalizeBackendUpstream(urlHost), {
      fetchImpl,
    }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(BackendProbeError)
    expect((error as Error).message).not.toContain(TOKEN)
    expect(error).toMatchObject({ state: 'misconfigured' })
  })

  it('rejects a declared or streamed oversized metadata body', async () => {
    const declared: BackendFetch = async () =>
      new Response('{}', { headers: { 'content-length': String(MAX_BACKEND_METADATA_BYTES + 1) } })
    await expect(
      probeBackendMetadata(normalizeBackendUpstream(urlHost), { fetchImpl: declared }),
    ).rejects.toMatchObject({ state: 'misconfigured' })

    const streamed: BackendFetch = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(MAX_BACKEND_METADATA_BYTES + 1))
            controller.close()
          },
        }),
      )
    await expect(
      probeBackendMetadata(normalizeBackendUpstream(urlHost), { fetchImpl: streamed }),
    ).rejects.toMatchObject({ state: 'misconfigured' })
  })

  it('enforces a hard deadline and caller cancellation', async () => {
    const never: BackendFetch = async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      })
    await expect(
      probeBackendMetadata(normalizeBackendUpstream(urlHost), {
        fetchImpl: never,
        timeoutMs: 5,
      }),
    ).rejects.toMatchObject({ state: 'offline' })

    const controller = new AbortController()
    controller.abort()
    await expect(
      probeBackendMetadata(normalizeBackendUpstream(urlHost), {
        fetchImpl: never,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ state: 'offline' })
  })

  it('rejects redirects without issuing a follow-up request', async () => {
    const fetchImpl = vi.fn<BackendFetch>(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://attacker.example.test/collect' },
        }),
    )
    await expect(
      probeBackendMetadata(normalizeBackendUpstream(urlHost), { fetchImpl }),
    ).rejects.toMatchObject({ state: 'offline' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
