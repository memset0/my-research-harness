// @vitest-environment node

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/server/runtime', () => ({ getRuntime: vi.fn() }))
vi.mock('@/lib/server/central/fleet-runtime', () => ({ getCentralFleet: vi.fn() }))
vi.mock('@/lib/server/central/backend-proxy', () => ({ proxyCentralApiRequest: vi.fn() }))

import { proxyCentralApiRequest } from '@/lib/server/central/backend-proxy'
import { getCentralFleet } from '@/lib/server/central/fleet-runtime'
import { getRuntime } from '@/lib/server/runtime'
import { GET, POST } from './route'

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-share-route-'))
  vi.clearAllMocks()
  vi.mocked(getCentralFleet).mockResolvedValue({ registry: { marker: 'registry' } } as never)
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

function request(host?: string): NextRequest {
  return new NextRequest(
    `http://central.internal/api/projects/shared-project/shares${host ? `?host=${host}` : ''}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-host': 'memon.example.test',
        'x-forwarded-proto': 'https',
      },
      body: JSON.stringify({ label: 'Reviewer', expires: 'never' }),
    },
  )
}

describe('central/standalone share create composition', () => {
  it('points central callers to the scoped share API', async () => {
    vi.mocked(getRuntime).mockResolvedValue({
      config: { central: { hosts: [] }, projects: [] },
    } as never)
    const params = { params: Promise.resolve({ project: 'shared-project' }) }
    const listed = await GET(
      new NextRequest('https://memon.example.test/api/projects/shared-project/shares?host=host-a'),
      params,
    )
    const created = await POST(request('host-a'), params)
    for (const response of [listed, created]) {
      expect(response.status).toBe(410)
      expect(await response.json()).toMatchObject({ error: { code: 'GONE' } })
    }
    expect(proxyCentralApiRequest).not.toHaveBeenCalled()
  })

  it('preserves standalone Project-root creation and legacy share URL', async () => {
    const runtime = { config: { projects: [{ name: 'shared-project', root }] } }
    vi.mocked(getRuntime).mockResolvedValue(runtime as never)
    const response = await POST(request(), {
      params: Promise.resolve({ project: 'shared-project' }),
    })
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.share.share_url).toMatch(
      /^https:\/\/memon\.example\.test\/share\/shared-project\/[A-Za-z0-9_-]+$/,
    )
    expect(proxyCentralApiRequest).not.toHaveBeenCalled()

    const listed = await GET(
      new NextRequest('http://central.internal/api/projects/shared-project/shares'),
      { params: Promise.resolve({ project: 'shared-project' }) },
    )
    expect(listed.status).toBe(200)
    expect(await listed.json()).toMatchObject({
      shares: [{ id: body.share.id, token: '' }],
    })
  })
})
