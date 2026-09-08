import type { AddressInfo } from 'node:net'
import type { BackendCapabilities } from '@memon/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BACKEND_ACTOR_CONTEXT_HEADER } from './actor-context.js'
import { createBackendServer } from './server.js'
import { createBackendSlurmService } from './slurm-service.js'

const TOKEN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const base: BackendCapabilities = {
  projects: true,
  mutations: true,
  events: true,
  logStreaming: true,
  reportAssets: true,
  wikiAssets: true,
  git: true,
  shares: true,
  slurm: true,
}
const servers: ReturnType<typeof createBackendServer>[] = []
afterEach(async () => {
  await Promise.all(
    servers.map((server) => new Promise<void>((done) => server.close(() => done()))),
  )
  servers.length = 0
})
async function start(
  hostId: string,
  capabilities: BackendCapabilities,
  provider: () => Promise<never[]>,
  readOnly = false,
) {
  const server = createBackendServer({
    hostId,
    serviceTokens: { current: TOKEN },
    capabilities,
    readOnly,
    revision: 'revision-a',
    slurmService: createBackendSlurmService({ totalNodes: 8, provider }),
  })
  servers.push(server)
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}
function actor(host: string, project = 'project-a') {
  return Buffer.from(JSON.stringify({ role: 'viewer', scopes: [{ host, project }] })).toString(
    'base64url',
  )
}
async function get(origin: string, host: string, project = 'project-a') {
  return fetch(`${origin}/api/backend/v1/slurm/status?project=${project}`, {
    headers: {
      authorization: `Bearer ${TOKEN}`,
      [BACKEND_ACTOR_CONTEXT_HEADER]: actor(host, project),
    },
  })
}

describe('Backend Slurm Host/Project isolation', () => {
  it('calls only the selected enabled Host provider', async () => {
    const a = vi.fn(async () => [] as never[])
    const b = vi.fn(async () => [] as never[])
    const [originA, originB] = await Promise.all([
      start('host-a', base, a),
      start('host-b', { ...base, slurm: false }, b),
    ])
    expect((await get(originA, 'host-a')).status).toBe(200)
    expect((await get(originA, 'host-b')).status).toBe(403)
    expect((await get(originB, 'host-b')).status).toBe(404)
    expect(a).toHaveBeenCalledOnce()
    expect(b).not.toHaveBeenCalled()
  })
  it('read_only and cross-Host actor fail before shell-out', async () => {
    const provider = vi.fn(async () => [] as never[])
    const origin = await start('host-a', base, provider, true)
    expect((await get(origin, 'host-a')).status).toBe(404)
    expect((await get(origin, 'host-b')).status).toBe(404)
    expect(provider).not.toHaveBeenCalled()
  })
})
