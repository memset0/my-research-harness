// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/runtime', () => ({ getRuntime: vi.fn() }))

import { getRuntime } from '@/lib/runtime'
import {
  closeUiPreferencesStores,
  UI_PREFERENCES_DB_FILENAME,
} from '@/lib/server/ui-preferences-store'
import { GET, PUT } from './route'

let directory: string

function request(
  method: 'GET' | 'PUT',
  key: string,
  value?: unknown,
  role: 'owner' | 'viewer' | 'anon' = 'owner',
): NextRequest {
  return new NextRequest(`http://localhost/api/ui-preferences?key=${encodeURIComponent(key)}`, {
    method,
    headers: {
      'x-memon-role': role,
      ...(method === 'PUT' ? { 'content-type': 'application/json' } : {}),
    },
    body: method === 'PUT' ? JSON.stringify({ key, value }) : undefined,
  })
}

beforeEach(async () => {
  vi.clearAllMocks()
  directory = await mkdtemp(join(tmpdir(), 'memon-ui-preferences-route-'))
  vi.mocked(getRuntime).mockResolvedValue({
    configPath: join(directory, 'config.yml'),
    auth: { username: 'alice' },
  } as Awaited<ReturnType<typeof getRuntime>>)
})

afterEach(async () => {
  await closeUiPreferencesStores()
  await rm(directory, { recursive: true, force: true })
})

describe('/api/ui-preferences', () => {
  it('returns found=false when SQLite has no row', async () => {
    const response = await GET(request('GET', 'results-key'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ found: false })
  })

  it('round-trips an explicitly empty filter list as found=true', async () => {
    const saved = await PUT(request('PUT', 'results-key', { rowFilters: [] }))
    expect(saved.status).toBe(200)

    const response = await GET(request('GET', 'results-key'))
    expect(await response.json()).toMatchObject({
      found: true,
      value: { rowFilters: [] },
    })
  })

  it('binds records to the authenticated runtime username', async () => {
    await PUT(request('PUT', 'results-key', { maxLines: 4 }))
    vi.mocked(getRuntime).mockResolvedValue({
      configPath: join(directory, 'config.yml'),
      auth: { username: 'bob' },
    } as Awaited<ReturnType<typeof getRuntime>>)

    const response = await GET(request('GET', 'results-key'))
    expect(await response.json()).toEqual({ found: false })
  })

  it.each(['viewer', 'anon'] as const)('keeps %s users browser-only', async (role) => {
    const response = await GET(request('GET', 'results-key', undefined, role))
    expect(response.status).toBe(403)
    expect(getRuntime).not.toHaveBeenCalled()

    const databasePath = join(directory, UI_PREFERENCES_DB_FILENAME)
    await expect(
      import('node:fs/promises').then(({ stat }) => stat(databasePath)),
    ).rejects.toThrow()
  })
})
