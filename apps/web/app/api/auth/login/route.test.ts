// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeAccountStores, getAccountStore } from '@/lib/server/account-store'
import { verifySessionCookie } from '@/lib/server/auth/cookies'
import { __resetForTests } from '@/lib/server/auth/rate-limit'

vi.mock('@/lib/server/runtime', () => ({ getRuntime: vi.fn() }))

import { getRuntime, type Runtime } from '@/lib/server/runtime'
import { POST } from './route'

const SECRET = 'login-test-secret'
let directory: string
let configPath: string

beforeEach(async () => {
  __resetForTests()
  directory = await mkdtemp(join(tmpdir(), 'memon-login-'))
  configPath = join(directory, 'config.yml')
  vi.mocked(getRuntime).mockResolvedValue({
    configPath,
    auth: { username: 'owner', password: 'owner-pass', sessionSecret: SECRET },
  } as unknown as Runtime)
})

afterEach(async () => {
  await closeAccountStores()
  await rm(directory, { recursive: true, force: true })
})

let ip = 1
function login(username: string, password: string) {
  ip += 1
  return POST(
    new NextRequest('http://localhost/api/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-forwarded-for': `203.0.113.${ip}`,
      },
      body: JSON.stringify({ username, password }),
    }),
  )
}

function sessionOf(res: Response) {
  const cookie = res.headers.get('set-cookie') ?? ''
  const value = /memon-session=([^;]+)/.exec(cookie)?.[1]
  return verifySessionCookie(value, SECRET)
}

describe('POST /api/auth/login', () => {
  it('signs the config owner in as account #1 with a v1 cookie', async () => {
    const res = await login('owner', 'owner-pass')
    expect(res.status).toBe(200)
    expect(sessionOf(res)).toMatchObject({ v: 1, uid: 1 })
  })

  it('signs a stored account in with a v2 cookie, and refuses disabled or wrong passwords', async () => {
    const store = await getAccountStore(configPath, 'owner')
    const bob = await store.create({ username: 'bob', password: 'password1', level: 'user' })
    const ok = await login('bob', 'password1')
    expect(ok.status).toBe(200)
    expect(sessionOf(ok)).toMatchObject({ v: 2, uid: bob.id })

    expect((await login('bob', 'wrong-password')).status).toBe(401)
    await store.update(bob.id, { disabled: true })
    expect((await login('bob', 'password1')).status).toBe(401)
    expect((await login('owner', 'password1')).status).toBe(401)
  })
})
