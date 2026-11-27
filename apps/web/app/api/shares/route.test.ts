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

import { closeAccountStores, getAccountStore } from '@/lib/server/account-store'
import { encodeAccountHeader } from '@/lib/server/auth/request-context'
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
    auth: { username: 'owner', password: 'pw' },
    config: {
      central: { hosts: [] },
      projects: [{ name: 'project-x', host: 'host-a', root: directory }],
    },
  } as never)
})
afterEach(async () => {
  await closeAccountStores()
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
      path: '/host-a/project-x/w/4',
      label: 'Alice',
    })
    expect(share.share_url).toBe(
      `https://memon.example.test/host-a/project-x/w/4?share=${share.token}`,
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
      share_url: 'https://memon.example.test/host-a/project-x/w/4',
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
      `https://memon.example.test/host-a/project-x/w/4?share=${share.token}`,
    )
  })

  it('scopes admins to their own shares on any Project and names creators for the super admin', async () => {
    const store = await getAccountStore(join(directory, 'config.yml'), 'owner')
    const ada = await store.create({ username: 'ada', password: 'password1', level: 'admin' })
    const ADA = {
      ...OWNER,
      'x-memon-role': 'viewer',
      'x-memon-account': encodeAccountHeader({ id: ada.id, username: 'ada', level: 'admin' }),
    }
    const body = { host: 'host-a', project: 'project-x', scope: { kind: 'project' } }
    expect((await create({ ...body, host: 'host-b' }, ADA)).status).toBe(404)

    const legacy = await (await create({ ...body, label: 'before' })).json()
    // A record written before creator tracking existed.
    const registryFile = join(directory, 'shares.json')
    const file = JSON.parse(await fs.readFile(registryFile, 'utf8'))
    for (const record of file.shares) delete record.created_by
    await fs.writeFile(registryFile, JSON.stringify(file))
    const own = await create({ ...body, label: 'mine' }, ADA)
    expect(own.status).toBe(201)
    expect((await own.json()).share).toMatchObject({ created_by: 'ada' })

    const list = (headers: Record<string, string>) =>
      GET(new NextRequest('http://central.internal/api/shares', { headers })).then((r) => r.json())
    const adaRows = (await list(ADA)).shares
    expect(adaRows.map((row: { label: string }) => row.label)).toEqual(['mine'])

    const allRows = (await list(OWNER)).shares
    expect(
      allRows.map((row: { label: string; created_by: string; legacy?: true }) => [
        row.label,
        row.created_by,
        row.legacy ?? false,
      ]),
    ).toEqual([
      ['before', 'owner', true],
      ['mine', 'ada', false],
    ])

    const revoke = (id: string, headers: Record<string, string>) =>
      DELETE(
        new NextRequest(`http://central.internal/api/shares/${id}`, { method: 'DELETE', headers }),
        {
          params: Promise.resolve({ id }),
        },
      )
    expect((await revoke(legacy.share.id, ADA)).status).toBe(404)
    expect((await revoke(adaRows[0].id, ADA)).status).toBe(200)
    expect((await revoke(legacy.share.id, OWNER)).status).toBe(200)
  })
})
