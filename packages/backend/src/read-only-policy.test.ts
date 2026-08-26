import type { AddressInfo } from 'node:net'
import { BACKEND_API_MAJOR, type BackendCapabilities, BackendMetadataSchema } from '@memon/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BACKEND_ACTOR_CONTEXT_HEADER } from './actor-context.js'
import { createBackendServer } from './server.js'

const TOKEN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
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
  slurm: true,
  herdr: true,
}
const servers: ReturnType<typeof createBackendServer>[] = []
afterEach(async () => {
  await Promise.all(
    servers.map((server) => new Promise<void>((done) => server.close(() => done()))),
  )
  servers.length = 0
})
async function start(options: Parameters<typeof createBackendServer>[0]) {
  const server = createBackendServer(options)
  servers.push(server)
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}
const owner = Buffer.from(JSON.stringify({ role: 'owner' })).toString('base64url')
function request(origin: string, path: string, init: RequestInit = {}) {
  return fetch(`${origin}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      [BACKEND_ACTOR_CONTEXT_HEADER]: owner,
      'content-type': 'application/json',
      ...init.headers,
    },
  })
}

describe('Backend read-only migration policy', () => {
  it('forces write/shell metadata capabilities false while keeping reads', async () => {
    const origin = await start({
      hostId: 'host-a',
      serviceTokens: { current: TOKEN },
      capabilities,
      readOnly: true,
      revision: 'revision-a',
      projectDiscovery: () => [{ name: 'project-a' }],
    })
    const meta = BackendMetadataSchema.parse(
      await (await request(origin, '/api/backend/v1/meta')).json(),
    )
    expect(meta.apiMajor).toBe(BACKEND_API_MAJOR)
    expect(meta.capabilities).toMatchObject({
      projects: true,
      mutations: false,
      tmux: false,
      terminal: false,
      slurm: false,
      herdr: false,
    })
    expect((await request(origin, '/api/backend/v1/projects')).status).toBe(200)
  })

  it('rejects document writes and share create/revoke before providers run', async () => {
    const add = vi.fn()
    const revoke = vi.fn()
    const putReport = vi.fn()
    const origin = await start({
      hostId: 'host-a',
      serviceTokens: { current: TOKEN },
      capabilities,
      readOnly: true,
      revision: 'revision-a',
      shareProviders: { add, revoke },
      documentService: {
        listReports: vi.fn(),
        getReport: vi.fn(),
        putReport,
        listDigests: vi.fn(),
        getDigest: vi.fn(),
        putDigest: vi.fn(),
        listCodeReviews: vi.fn(),
        getCodeReview: vi.fn(),
        patchCodeReview: vi.fn(),
        getReadme: vi.fn(),
        putReadme: vi.fn(),
      } as never,
    })
    expect(
      (
        await request(origin, '/api/backend/v1/reports/R0001?project=project-a', {
          method: 'PUT',
          body: '{}',
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await request(origin, '/api/backend/v1/projects/project-a/shares', {
          method: 'POST',
          body: '{}',
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await request(origin, '/api/backend/v1/projects/project-a/shares/shr_abcdefgh', {
          method: 'DELETE',
          body: '{}',
        })
      ).status,
    ).toBe(403)
    expect(putReport).not.toHaveBeenCalled()
    expect(add).not.toHaveBeenCalled()
    expect(revoke).not.toHaveBeenCalled()
  })

  it('keeps share validation readable but rejects terminal relay even when mis-advertised', async () => {
    const resolver = vi.fn(() => 'http://127.0.0.1:12345')
    const origin = await start({
      hostId: 'host-a',
      serviceTokens: { current: TOKEN },
      capabilities,
      readOnly: true,
      revision: 'revision-a',
      shareValidator: () => true,
      terminalTargetResolver: resolver,
    })
    const validation = await request(origin, '/api/backend/v1/projects/project-a/shares/validate', {
      method: 'POST',
      body: JSON.stringify({ token: 's'.repeat(24) }),
    })
    expect(validation.status).toBe(200)
    const relay = await request(origin, '/api/backend/v1/terminal/proxy/session-a/')
    expect(relay.status).toBe(403)
    expect(resolver).not.toHaveBeenCalled()
  })
})
