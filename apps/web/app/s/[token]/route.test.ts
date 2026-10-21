// @vitest-environment node

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/server/runtime', () => ({ getRuntime: vi.fn() }))

import {
  MAX_SHARE_COOKIE_ENTRIES,
  mergeShareCookie,
  SHARES_COOKIE_NAME,
  verifySharesCookie,
} from '@/lib/server/auth/cookies'
import { getRuntime } from '@/lib/server/runtime'
import { shareRegistryFor } from '@/lib/server/share-registry'
import { GET } from './route'

const SECRET = 'test-secret-'.repeat(4)
let directory: string

beforeEach(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), 'memon-share-landing-'))
  vi.clearAllMocks()
  vi.mocked(getRuntime).mockResolvedValue({
    configPath: join(directory, 'config.yml'),
    auth: { sessionSecret: SECRET },
    config: { central: { hosts: [] }, projects: [] },
  } as never)
})
afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

function open(token: string, cookie?: string) {
  return GET(
    new NextRequest(`https://memon.example.test/s/${token}`, {
      headers: {
        'x-forwarded-host': 'memon.example.test',
        'x-forwarded-proto': 'https',
        ...(cookie ? { cookie: `${SHARES_COOKIE_NAME}=${cookie}` } : {}),
      },
    }),
    { params: Promise.resolve({ token }) },
  )
}

function cookieValue(response: Response): string {
  const header = response.headers.get('set-cookie') ?? ''
  return /memon-shares=([^;]+)/.exec(header)?.[1] ?? ''
}

describe('/s/<token>', () => {
  it('lands on the issued page and keeps several page links of one Project', async () => {
    const registry = shareRegistryFor(join(directory, 'config.yml'))
    const wiki = await registry.create({
      host: 'host-a',
      project: 'project-x',
      scope: { kind: 'wiki', id: 'W0004' },
    })
    const report = await registry.create({
      host: 'host-a',
      project: 'project-x',
      scope: { kind: 'report', id: 'R0005' },
    })

    const first = await open(wiki.token)
    expect(first.status).toBe(302)
    expect(first.headers.get('location')).toBe(
      'https://memon.example.test/h/host-a/p/project-x/wiki/W0004',
    )
    const second = await open(report.token, cookieValue(first))
    expect(second.headers.get('location')).toBe(
      'https://memon.example.test/h/host-a/p/project-x/reports/R0005',
    )
    expect(verifySharesCookie(cookieValue(second), SECRET)?.entries).toEqual([
      { host: 'host-a', project: 'project-x', token: wiki.token },
      { host: 'host-a', project: 'project-x', token: report.token },
    ])
  })

  it('answers unknown and revoked tokens with the generic page', async () => {
    const registry = shareRegistryFor(join(directory, 'config.yml'))
    const record = await registry.create({
      host: 'host-a',
      project: 'project-x',
      scope: { kind: 'project' },
    })
    await registry.remove(record.id)
    for (const token of [record.token, 'not-a-token', 'a'.repeat(24)]) {
      const response = await open(token)
      expect(response.status).toBe(404)
      expect(response.headers.get('set-cookie')).toBeNull()
    }
  })
})

describe('mergeShareCookie', () => {
  it('deduplicates by token and keeps the newest entries', () => {
    let cookie: string | null = null
    for (let index = 0; index <= MAX_SHARE_COOKIE_ENTRIES; index += 1) {
      cookie = mergeShareCookie(
        verifySharesCookie(cookie, SECRET),
        { host: 'host-a', project: 'project-x', token: `token-${index}` },
        SECRET,
      )
    }
    const again = mergeShareCookie(
      verifySharesCookie(cookie, SECRET),
      { host: 'host-a', project: 'project-x', token: `token-${MAX_SHARE_COOKIE_ENTRIES}` },
      SECRET,
    )
    const entries = verifySharesCookie(again, SECRET)?.entries ?? []
    expect(entries).toHaveLength(MAX_SHARE_COOKIE_ENTRIES)
    expect(entries[0]?.token).toBe('token-1')
    expect(entries.at(-1)?.token).toBe(`token-${MAX_SHARE_COOKIE_ENTRIES}`)
  })
})
