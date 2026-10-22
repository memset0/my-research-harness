// @vitest-environment node

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/server/runtime', () => ({ getRuntime: vi.fn() }))
vi.mock('@/lib/server/standalone-request', () => ({
  withStandaloneRequest: (handler: unknown) => handler,
}))
const getWiki = vi.fn()
vi.mock('@/lib/server/central/direct-runtime', () => ({
  directCentralRuntime: () => ({
    registry: { capabilities: (host: string) => (host === 'host-a' ? {} : null) },
    dispatch: async ({ request }: { request: Request }) => {
      const path = new URL(request.url).pathname
      const wiki = path === '/api/wiki/W0004' ? await getWiki() : null
      return wiki
        ? Response.json(wiki)
        : Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })
    },
  }),
}))

import { getRuntime } from '@/lib/server/runtime'
import { DELETE } from './[id]/route'
import { GET, POST } from './route'

let directory: string

beforeEach(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), 'memon-shares-api-'))
  vi.clearAllMocks()
  getWiki.mockResolvedValue({ id: 'W0004' })
  vi.mocked(getRuntime).mockResolvedValue({
    configPath: join(directory, 'config.yml'),
    config: {
      central: { hosts: [] },
      projects: [{ name: 'project-x', host: 'host-a', root: directory }],
    },
  } as never)
})
afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

const OWNER = {
  'x-memon-role': 'owner',
  'x-forwarded-host': 'memon.example.test',
  'x-forwarded-proto': 'https',
}

function create(body: unknown, headers: Record<string, string> = OWNER) {
  return POST(
    new NextRequest('http://central.internal/api/shares', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  )
}

describe('/api/shares', () => {
  it('issues a page link, lists it with its scope and revokes it', async () => {
    const created = await create({
      host: 'host-a',
      project: 'project-x',
      scope: { kind: 'wiki', id: 'W0004' },
      label: 'Alice',
    })
    expect(created.status).toBe(201)
    const { share } = await created.json()
    expect(share).toMatchObject({
      host: 'host-a',
      project: 'project-x',
      scope: { kind: 'wiki', id: 'W0004' },
      path: '/h/host-a/p/project-x/wiki/W0004',
      label: 'Alice',
    })
    expect(share.share_url).toBe(
      `https://memon.example.test/h/host-a/p/project-x/wiki/W0004?share=${share.token}`,
    )

    const published = await create({
      host: 'host-a',
      project: 'project-x',
      scope: { kind: 'wiki', id: 'W0004' },
      public: true,
    })
    expect(published.status).toBe(201)
    expect((await published.json()).share).toMatchObject({
      public: true,
      share_url: 'https://memon.example.test/h/host-a/p/project-x/wiki/W0004',
    })

    const listed = await GET(
      new NextRequest('http://central.internal/api/shares?host=host-a&project=project-x', {
        headers: OWNER,
      }),
    )
    expect((await listed.json()).shares).toHaveLength(2)

    const revoked = await DELETE(
      new NextRequest(`http://central.internal/api/shares/${share.id}`, {
        method: 'DELETE',
        headers: OWNER,
      }),
      { params: Promise.resolve({ id: share.id }) },
    )
    expect(revoked.status).toBe(200)
    const again = await GET(
      new NextRequest('http://central.internal/api/shares', { headers: OWNER }),
    )
    expect((await again.json()).shares).toHaveLength(1)
  })

  it('rejects unknown Projects, wrong Hosts, unpublished documents and non-owners', async () => {
    expect(
      (await create({ host: 'host-b', project: 'project-x', scope: { kind: 'project' } })).status,
    ).toBe(404)
    expect(
      (await create({ host: 'host-a', project: 'missing', scope: { kind: 'project' } })).status,
    ).toBe(404)
    expect(
      (
        await create({
          host: 'host-a',
          project: 'project-x',
          scope: { kind: 'report', id: 'R0009' },
        })
      ).status,
    ).toBe(404)
    expect(
      (await create({ host: 'host-a', project: 'project-x', scope: { kind: 'wiki', id: 'x' } }))
        .status,
    ).toBe(400)
    expect(
      (
        await create(
          { host: 'host-a', project: 'project-x', scope: { kind: 'project' } },
          { 'x-memon-role': 'viewer' },
        )
      ).status,
    ).toBe(403)
  })

  it('issues a service link only for a service page and never a public one', async () => {
    const service = { host: 'host-a', project: 'project-x', scope: { kind: 'wiki', id: 'W0004' } }
    expect((await create({ ...service, service: true })).status).toBe(400)
    getWiki.mockResolvedValue({ id: 'W0004', presentation: 'service' })
    expect((await create({ ...service, service: true, public: true })).status).toBe(400)
    expect(
      (
        await create({
          host: 'host-a',
          project: 'project-x',
          scope: { kind: 'project' },
          service: true,
        })
      ).status,
    ).toBe(400)
    const created = await create({ ...service, service: true })
    expect(created.status).toBe(201)
    const { share } = await created.json()
    expect(share).toMatchObject({ service: true, scope: { kind: 'wiki', id: 'W0004' } })
    expect(share.share_url).toBe(
      `https://memon.example.test/h/host-a/p/project-x/wiki/W0004?share=${share.token}`,
    )
  })
})
