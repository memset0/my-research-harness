// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeAccountStores } from '@/lib/server/account-store'
import { encodeAccountHeader } from '@/lib/server/auth/request-context'

vi.mock('@/lib/server/runtime', () => ({ getRuntime: vi.fn() }))

import { getRuntime, type Runtime } from '@/lib/server/runtime'
import { PUT } from './[id]/grants/route'
import { PATCH } from './[id]/route'
import { GET, POST } from './route'

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'memon-admin-accounts-'))
  vi.mocked(getRuntime).mockResolvedValue({
    configPath: join(directory, 'config.yml'),
    auth: { username: 'owner', password: 'pw' },
  } as unknown as Runtime)
})

afterEach(async () => {
  await closeAccountStores()
  await rm(directory, { recursive: true, force: true })
})

function call(
  method: string,
  level: 'super_admin' | 'admin' | 'user',
  body?: unknown,
  path = '/api/admin/accounts',
) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: {
      'x-memon-role': level === 'user' ? 'viewer' : 'owner',
      'x-memon-account': encodeAccountHeader({
        id: level === 'super_admin' ? 1 : 5,
        username: 'u',
        level,
      }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })

describe('/api/admin/accounts', () => {
  it('lets the super admin create, edit and grant', async () => {
    const created = await POST(
      call('POST', 'super_admin', { username: 'bob', password: 'password1', level: 'user' }),
    )
    expect(created.status).toBe(201)
    const { account } = await created.json()
    expect(account).toMatchObject({ username: 'bob', level: 'user', managed_by_config: false })
    expect(JSON.stringify(account)).not.toMatch(/scrypt|password/)

    const granted = await PUT(
      call('PUT', 'super_admin', { grants: [{ host: 'host-a', project: 'project-a' }] }),
      params(String(account.id)),
    )
    expect((await granted.json()).account.grants).toEqual([
      { host: 'host-a', project: 'project-a' },
    ])

    const disabled = await PATCH(
      call('PATCH', 'super_admin', { disabled: true }),
      params(String(account.id)),
    )
    expect((await disabled.json()).account.disabled).toBe(true)

    const list = await (await GET(call('GET', 'super_admin'))).json()
    expect(
      list.accounts.map((a: { username: string; managed_by_config: boolean }) => [
        a.username,
        a.managed_by_config,
      ]),
    ).toEqual([
      ['owner', true],
      ['bob', false],
    ])
  })

  it('guards account #1 and validates input', async () => {
    expect(
      (await PATCH(call('PATCH', 'super_admin', { level: 'guest' }), params('1'))).status,
    ).toBe(400)
    expect(
      (
        await POST(
          call('POST', 'super_admin', {
            username: 'x',
            password: 'password1',
            level: 'super_admin',
          }),
        )
      ).status,
    ).toBe(400)
    expect((await PATCH(call('PATCH', 'super_admin', {}), params('2'))).status).toBe(400)
    expect(
      (await PATCH(call('PATCH', 'super_admin', { disabled: true }), params('99'))).status,
    ).toBe(404)
    expect(
      (await PATCH(call('PATCH', 'super_admin', { disabled: true }), params('abc'))).status,
    ).toBe(404)
  })

  it('refuses admins and users', async () => {
    for (const level of ['admin', 'user'] as const) {
      expect((await GET(call('GET', level))).status).toBe(403)
      expect(
        (
          await POST(
            call('POST', level, { username: 'eve', password: 'password1', level: 'guest' }),
          )
        ).status,
      ).toBe(403)
    }
  })
})
