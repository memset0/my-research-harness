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
import {
  CentralBackendProxyError,
  DEFAULT_BACKEND_HEADER_TIMEOUT_MS,
  MAX_BACKEND_CONTROL_BODY_BYTES,
  proxyCentralApiRequest,
} from './backend-proxy'
import { CentralHostRegistry, HostRoutingError } from './host-registry'

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
  slurm: true,
} satisfies BackendCapabilities

const CONFIG: CentralConfig = {
  bindAddr: '127.0.0.1',
  bindPort: 3737,
  hosts: [
    {
      id: 'host-a',
      tokens: { current: TOKEN },
      transport: {
        kind: 'url',
        baseUrl: 'https://backend-a.example.test',
        allowInsecureHttp: false,
      },
    },
  ],
}

function metadata(capabilities: BackendCapabilities = CAPABILITIES): BackendMetadata {
  return {
    host: 'host-a' as BackendMetadata['host'],
    release: MEMON_RELEASE as BackendMetadata['release'],
    apiMajor: BACKEND_API_MAJOR,
    revision: '0123456789abcdef' as BackendMetadata['revision'],
    instanceEpoch: '9c64885c-6671-4eb5-9648-d03e04987464' as BackendMetadata['instanceEpoch'],
    ready: true,
    capabilities,
  }
}

function usableRegistry(capabilities: BackendCapabilities = CAPABILITIES): CentralHostRegistry {
  const registry = new CentralHostRegistry(CONFIG)
  registry.acceptMetadata('host-a', metadata(capabilities))
  return registry
}

function proxy(
  request: Request,
  fetchImpl: NonNullable<Parameters<typeof proxyCentralApiRequest>[1]['fetchImpl']>,
  registry = usableRegistry(),
  overrides: Partial<Parameters<typeof proxyCentralApiRequest>[1]> = {},
) {
  return proxyCentralApiRequest(request, {
    registry,
    actor: { role: 'owner' },
    fetchImpl,
    ...overrides,
  })
}

function backendWikiDocument() {
  const content = [
    '---',
    'id: W0001',
    'kind: finding',
    'title: Finding',
    'created_at: 2026-05-01T10:00:00+08:00',
    'updated_at: 2026-05-01T10:00:00+08:00',
    '---',
    '```memon-data@1',
    'script: x',
    'captured_at: 2026-05-04T13:00:00+08:00',
    'captured_commit: null',
    'columns: [a, b]',
    'rows: [[1]]',
    '```',
  ].join('\n')
  return {
    id: 'W0001',
    project: 'project-a',
    resource: 'docs/wiki/finding/W0001-finding.md',
    slug: 'finding',
    kind: 'finding',
    title: 'Finding',
    description: null,
    status: 'TENTATIVE',
    date: null,
    tags: [],
    sources: ['E0001'],
    legacyId: null,
    entry: null,
    deprecated: null,
    deprecatedSections: [],
    stale: false,
    staleSources: [],
    review: null,
    format: 'markdown',
    mtime: 1,
    createdAt: '2026-05-01T10:00:00+08:00',
    updatedAt: '2026-05-01T10:00:00+08:00',
    diagnostics: [],
    hash: 'a'.repeat(40),
    content,
  }
}

describe('central Backend proxy routing and trust boundary', () => {
  it('requires Host on every route and Project on Project/resource scopes', async () => {
    const fetchImpl = vi.fn()
    await expect(
      proxy(new Request('https://central.example.test/api/runs?project=project-a'), fetchImpl),
    ).rejects.toMatchObject({ code: 'MISSING_HOST' })
    await expect(
      proxy(new Request('https://central.example.test/api/runs?host=host-a'), fetchImpl),
    ).rejects.toMatchObject({ code: 'MISSING_PROJECT' })
    await expect(
      proxy(
        new Request(
          'https://central.example.test/api/runs?host=host-a&host=host-b&project=project-a',
        ),
        fetchImpl,
      ),
    ).rejects.toBeInstanceOf(CentralBackendProxyError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('requires a usable configured Host before contacting an upstream', async () => {
    const registry = new CentralHostRegistry(CONFIG)
    const fetchImpl = vi.fn()
    await expect(
      proxy(
        new Request('https://central.example.test/api/runs?host=host-a&project=project-a'),
        fetchImpl,
        registry,
      ),
    ).rejects.toBeInstanceOf(HostRoutingError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('maps the allow-listed route, removes Host, and rebuilds trusted headers', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe(
        'https://backend-a.example.test/api/backend/v1/runs?project=project-a&inventory=1',
      )
      const headers = new Headers(init?.headers)
      expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`)
      expect(headers.get(BACKEND_ACTOR_CONTEXT_HEADER)).toBeTruthy()
      expect(headers.get('cookie')).toBeNull()
      expect(headers.get('x-forwarded-host')).toBeNull()
      expect(init?.redirect).toBe('manual')
      return Response.json({ ok: true })
    })
    const request = new Request(
      'https://central.example.test/api/runs?host=host-a&project=project-a&inventory=1',
      {
        headers: {
          authorization: 'Basic browser-secret',
          cookie: 'memon-session=browser',
          'x-forwarded-host': 'attacker.example',
        },
      },
    )

    expect((await proxy(request, fetchImpl)).status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('validates a Project carried in the public path', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json({ ok: true }),
    )
    const response = await proxy(
      new Request('https://central.example.test/api/projects/project-a/git-status?host=host-a'),
      fetchImpl,
    )
    expect(response.status).toBe(200)
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      'https://backend-a.example.test/api/backend/v1/projects/project-a/git-status',
    )
  })

  it('gates routes on negotiated Host capabilities before fetch', async () => {
    const fetchImpl = vi.fn()
    const registry = usableRegistry({ ...CAPABILITIES, git: false })
    await expect(
      proxy(
        new Request('https://central.example.test/api/projects/project-a/git-status?host=host-a'),
        fetchImpl,
        registry,
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('uses the dedicated shares capability when broad mutations are disabled', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json(
        {
          share: {
            id: 'shr_abcdefgh',
            token: 'share_token',
            created_at: '2026-08-27T12:00:00Z',
            expires_at: null,
          },
        },
        { status: 201 },
      ),
    )
    const registry = usableRegistry({ ...CAPABILITIES, mutations: false, shares: true })
    const response = await proxy(
      new Request('https://central.example.test/api/projects/project-a/shares?host=host-a', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expires: 'never' }),
      }),
      fetchImpl,
      registry,
    )
    expect(response.status).toBe(201)
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      'https://backend-a.example.test/api/backend/v1/projects/project-a/shares',
    )
  })
})

describe('central Wiki proxy projection', () => {
  it('adds central component diagnostics to a Backend-served wiki page', async () => {
    const encoded = JSON.stringify(backendWikiDocument())
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(encoded, {
          headers: {
            'content-type': 'application/json',
            'content-encoding': 'gzip',
            'content-length': String(Buffer.byteLength(encoded)),
            etag: '\"backend-page\"',
            'last-modified': 'Mon, 01 May 2026 02:00:00 GMT',
          },
        }),
    )
    const response = await proxy(
      new Request('https://central.example.test/api/wiki/W0001?host=host-a&project=project-a', {
        headers: { 'if-none-match': '\"backend-page\"', range: 'bytes=0-10' },
      }),
      fetchImpl,
    )
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.components).toEqual([
      { index: 0, name: 'memon-data', version: 1, line: 8, outdated: false },
    ])
    expect(payload.diagnostics).toEqual([
      expect.objectContaining({ code: 'WIKI_DATA_BLOCK_INVALID', line: 8 }),
    ])
    expect(response.headers.get('content-encoding')).toBeNull()
    expect(response.headers.get('content-length')).toBeNull()
    expect(response.headers.get('etag')).toBeNull()
    const forwarded = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers)
    expect(forwarded.has('if-none-match')).toBe(false)
    expect(forwarded.has('range')).toBe(false)
  })

  it('gates wiki assets on wikiAssets without affecting report assets', async () => {
    const fetchImpl = vi.fn()
    const registry = usableRegistry({ ...CAPABILITIES, wikiAssets: false })
    await expect(
      proxy(
        new Request(
          'https://central.example.test/api/wiki-assets/project-a/W0001/view.html?host=host-a',
        ),
        fetchImpl,
        registry,
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('forwards shell-class review marks to a read-only Backend', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ verifiedThrough: null, commits: [] }),
    )
    const registry = usableRegistry({ ...CAPABILITIES, mutations: false })
    const response = await proxy(
      new Request(
        'https://central.example.test/api/wiki/review/next?host=host-a&project=project-a',
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      ),
      fetchImpl,
      registry,
    )
    expect(response.status).toBe(200)
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      'https://backend-a.example.test/api/backend/v1/wiki/review/next?project=project-a',
    )
  })
})

describe('central Backend proxy streaming and bounds', () => {
  it('passes a non-control request body and cancellation signal through without buffering', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('stream-one'))
        controller.enqueue(new TextEncoder().encode('stream-two'))
        controller.close()
      },
    })
    const request = new Request(
      'https://central.example.test/api/experiments?host=host-a&project=project-a',
      {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: stream,
        duplex: 'half',
      } as RequestInit & { duplex: 'half' },
    )
    const requestBody = request.body
    const fetchImpl = vi.fn(async (_input, init) => {
      expect(init?.body).toBe(requestBody)
      expect(init?.signal).not.toBe(request.signal)
      expect(init?.signal?.aborted).toBe(false)
      return new Response(null, { status: 204 })
    })

    expect((await proxy(request, fetchImpl)).status).toBe(204)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('bounds JSON/control bodies before contacting the Backend', async () => {
    const fetchImpl = vi.fn()
    const request = new Request(
      'https://central.example.test/api/runs/run-a/readme?host=host-a&project=project-a',
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: 'too-large' }),
      },
    )
    await expect(
      proxy(request, fetchImpl, usableRegistry(), { maxControlBodyBytes: 8 }),
    ).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('keeps the default JSON/control bound finite', () => {
    expect(MAX_BACKEND_CONTROL_BODY_BYTES).toBe(1024 * 1024)
    expect(DEFAULT_BACKEND_HEADER_TIMEOUT_MS).toBe(30_000)
  })

  it('relays Backend bytes as a stream and copies only safe response headers', async () => {
    let pulls = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        controller.enqueue(new TextEncoder().encode(pulls === 1 ? 'hello ' : 'world'))
        if (pulls === 2) controller.close()
      },
    })
    const fetchImpl = vi.fn(async () =>
      Promise.resolve(
        new Response(body, {
          status: 206,
          headers: {
            'content-range': 'bytes 0-10/11',
            'content-type': 'application/octet-stream',
            etag: 'safe-etag',
            location: 'https://attacker.example',
            'set-cookie': 'memon-session=attacker',
            'www-authenticate': 'Basic realm="backend"',
            'x-memon-private': 'secret',
          },
        }),
      ),
    )

    const response = await proxy(
      new Request(
        'https://central.example.test/api/log?host=host-a&project=project-a&path=run.log',
      ),
      fetchImpl,
    )
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 0-10/11')
    expect(response.headers.get('etag')).toBe('safe-etag')
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('www-authenticate')).toBeNull()
    expect(response.headers.get('x-memon-private')).toBeNull()
    expect(pulls).toBeLessThan(2)
    expect(await response.text()).toBe('hello world')
    expect(pulls).toBe(2)
  })

  it('rejects an oversized allow-listed Backend response header', async () => {
    const registry = usableRegistry()
    const fetchImpl = vi.fn(async () =>
      Promise.resolve(
        new Response('private body', {
          headers: { 'content-type': `text/plain; parameter=${'x'.repeat(9000)}` },
        }),
      ),
    )
    const response = await proxy(
      new Request('https://central.example.test/api/runs?host=host-a&project=project-a'),
      fetchImpl,
      registry,
    )
    expect(response.status).toBe(502)
    expect(registry.getAvailability('host-a')?.state).toBe('misconfigured')
    expect(await response.text()).not.toContain('private body')
  })
})

describe('central Backend proxy failures and mutation replay', () => {
  it('maps Backend 401 to a safe Host auth failure without a browser challenge', async () => {
    const registry = usableRegistry()
    const fetchImpl = vi.fn(async () =>
      Promise.resolve(
        new Response(`rejected ${TOKEN}`, {
          status: 401,
          headers: { 'www-authenticate': 'Bearer private-backend' },
        }),
      ),
    )
    const response = await proxy(
      new Request('https://central.example.test/api/runs?host=host-a&project=project-a'),
      fetchImpl,
      registry,
    )

    expect(response.status).toBe(503)
    expect(response.headers.get('www-authenticate')).toBeNull()
    expect(registry.getAvailability('host-a')?.state).toBe('authentication_failed')
    expect(await response.text()).not.toContain(TOKEN)
  })

  it('does not replay a mutation after an upstream failure', async () => {
    const registry = usableRegistry()
    const fetchImpl = vi.fn(async () => {
      throw new Error('connection dropped after write')
    })
    const request = new Request(
      'https://central.example.test/api/runs/run-a/readme?host=host-a&project=project-a',
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: 'updated' }),
      },
    )

    const response = await proxy(request, fetchImpl, registry)
    expect(response.status).toBe(503)
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(registry.getAvailability('host-a')?.state).toBe('offline')
  })

  it('passes cancellation to fetch and does not misclassify a client abort as Host failure', async () => {
    const registry = usableRegistry()
    const controller = new AbortController()
    const request = new Request(
      'https://central.example.test/api/runs?host=host-a&project=project-a',
      { signal: controller.signal },
    )
    const fetchImpl = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          expect(init?.signal).not.toBe(request.signal)
          if (init?.signal?.aborted) {
            reject(init.signal.reason)
            return
          }
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
        }),
    )

    const pending = proxy(request, fetchImpl, registry)
    controller.abort(new Error('client disconnected'))
    await expect(pending).rejects.toThrow('client disconnected')
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(registry.getAvailability('host-a')?.state).toBe('online')
  })

  it('bounds the wait for Backend response headers without replaying the request', async () => {
    const registry = usableRegistry()
    const fetchImpl = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
        }),
    )
    const response = await proxy(
      new Request('https://central.example.test/api/runs?host=host-a&project=project-a'),
      fetchImpl,
      registry,
      { headerTimeoutMs: 5 },
    )
    expect(response.status).toBe(503)
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(registry.getAvailability('host-a')?.state).toBe('offline')
  })
})
