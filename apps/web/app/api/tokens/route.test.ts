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
import { DELETE } from './[id]/route'
import { GET, POST } from './route'

let directory: string
let configPath: string
const SUPER: RequestAccount = { id: 1, username: 'owner', level: 'super_admin' }
let ada: RequestAccount
let bob: RequestAccount
let gil: RequestAccount

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'memon-tokens-'))
  configPath = join(directory, 'config.yml')
  vi.mocked(getRuntime).mockResolvedValue({
    configPath,
    auth: { username: 'owner', password: 'pw' },
    config: { projects: [] },
  } as unknown as Runtime)
  const store = await getAccountStore(configPath, 'owner')
  const make = async (username: string, level: 'admin' | 'user' | 'guest') => {
    const created = await store.create({ username, password: 'password1', level })
    return { id: created.id, username, level } as RequestAccount
  }
  ada = await make('ada', 'admin')
  bob = await make('bob', 'user')
  gil = await make('gil', 'guest')
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

const params = (id: string) => ({ params: Promise.resolve({ id }) })

describe('/api/tokens', () => {
  it('creates a token whose value appears only in the create response', async () => {
    const created = await POST(call(ada, 'POST', '/api/tokens', { name: 'laptop' }))
    expect(created.status).toBe(201)
    const body = await created.json()
    expect(body.value).toMatch(/^mtk_/)
    expect(body.token).toMatchObject({ username: 'ada', name: 'laptop', expires_at: null })
    const listed = await (await GET(call(ada, 'GET', '/api/tokens'))).json()
    expect(listed.tokens.map((t: { name: string }) => t.name)).toEqual(['laptop'])
    expect(JSON.stringify(listed)).not.toContain(body.value)
  })

  it('scopes listing and revoking to the caller, except for the super admin', async () => {
    const adaToken = (await (await POST(call(ada, 'POST', '/api/tokens', { name: 'a' }))).json())
      .token
    await POST(call(bob, 'POST', '/api/tokens', { name: 'b' }))
    expect((await (await GET(call(bob, 'GET', '/api/tokens'))).json()).tokens).toHaveLength(1)
    expect((await (await GET(call(SUPER, 'GET', '/api/tokens'))).json()).tokens).toHaveLength(2)

    const id = String(adaToken.id)
    expect((await DELETE(call(bob, 'DELETE', `/api/tokens/${id}`), params(id))).status).toBe(404)
    expect((await DELETE(call(SUPER, 'DELETE', `/api/tokens/${id}`), params(id))).status).toBe(200)
    expect((await DELETE(call(ada, 'DELETE', `/api/tokens/${id}`), params(id))).status).toBe(404)
  })

  it('refuses guests and invalid requests', async () => {
    expect((await GET(call(gil, 'GET', '/api/tokens'))).status).toBe(403)
    expect((await POST(call(ada, 'POST', '/api/tokens', { name: '' }))).status).toBe(400)
    expect(
      (await POST(call(ada, 'POST', '/api/tokens', { name: 'x', expires_at: '2020-01-01T00:00' })))
        .status,
    ).toBe(400)
    expect(
      (
        await POST(
          call(ada, 'POST', '/api/tokens', { name: 'x', expires_at: '2020-01-01T00:00:00Z' }),
        )
      ).status,
    ).toBe(400)
    const ok = await POST(
      call(ada, 'POST', '/api/tokens', { name: 'x', expires_at: '2099-01-01T00:00:00+08:00' }),
    )
    expect(ok.status).toBe(201)
  })
})
