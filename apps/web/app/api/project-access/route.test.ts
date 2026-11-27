// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeAccountStores, getAccountStore } from '@/lib/server/account-store'
import { encodeAccountHeader, type RequestAccount } from '@/lib/server/auth/request-context'

vi.mock('@/lib/server/runtime', () => ({ getRuntime: vi.fn() }))

import { getRuntime, type Runtime } from '@/lib/server/runtime'
import { DELETE, GET, POST } from './route'

let directory: string
let configPath: string
const SUPER: RequestAccount = { id: 1, username: 'owner', level: 'super_admin' }
let ada: RequestAccount

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'memon-project-access-'))
  configPath = join(directory, 'config.yml')
  vi.mocked(getRuntime).mockResolvedValue({
    configPath,
    auth: { username: 'owner', password: 'pw' },
    config: {
      projects: [
        { name: 'project-a', host: 'host-a' },
        { name: 'project-b', host: 'host-a' },
      ],
    },
  } as unknown as Runtime)
  const store = await getAccountStore(configPath, 'owner')
  const created = await store.create({ username: 'ada', password: 'password1', level: 'admin' })
  ada = { id: created.id, username: 'ada', level: 'admin' }
  await store.create({ username: 'bob', password: 'password1', level: 'user' })
})

afterEach(async () => {
  await closeAccountStores()
  await rm(directory, { recursive: true, force: true })
})

function call(account: RequestAccount, method: string, url: string, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: {
      'x-memon-account': encodeAccountHeader(account),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('project access', () => {
  it('shows an admin every Project and lets it grant users on any of them', async () => {
    const listed = (await (await GET(call(ada, 'GET', '/api/project-access'))).json()).projects
    expect(listed).toEqual([
      { host: 'host-a', project: 'project-a', grants: [] },
      { host: 'host-a', project: 'project-b', grants: [] },
    ])

    const add = { host: 'host-a', project: 'project-b', username: 'bob' }
    expect((await POST(call(ada, 'POST', '/api/project-access', add))).status).toBe(200)
    const after = (await (await GET(call(ada, 'GET', '/api/project-access'))).json()).projects
    expect(after[1].grants).toEqual([{ username: 'bob' }])

    expect(
      (await POST(call(ada, 'POST', '/api/project-access', { ...add, project: 'missing' }))).status,
    ).toBe(404)
    const unknown = await POST(
      call(ada, 'POST', '/api/project-access', { ...add, username: 'nobody' }),
    )
    const admin = await POST(call(ada, 'POST', '/api/project-access', { ...add, username: 'ada' }))
    expect([unknown.status, admin.status]).toEqual([400, 400])
    expect(await unknown.json()).toEqual(await admin.json())

    expect((await DELETE(call(ada, 'DELETE', '/api/project-access', add))).status).toBe(200)
  })

  it('shows the super admin the same Projects, with no admin assignments', async () => {
    const listed = (await (await GET(call(SUPER, 'GET', '/api/project-access'))).json()).projects
    expect(listed).toEqual([
      { host: 'host-a', project: 'project-a', grants: [] },
      { host: 'host-a', project: 'project-b', grants: [] },
    ])
  })
})
