// @vitest-environment node

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/runtime', () => ({ getRuntime: vi.fn() }))
vi.mock('@/lib/central/fleet-runtime', () => ({ getCentralFleet: vi.fn() }))
vi.mock('@/lib/central/backend-proxy', () => ({ proxyCentralApiRequest: vi.fn() }))

import { proxyCentralApiRequest } from '@/lib/central/backend-proxy'
import { getCentralFleet } from '@/lib/central/fleet-runtime'
import { getRuntime } from '@/lib/runtime'
import { GET, POST } from './route'

const RECORD = {
  id: 'shr_abcdefgh',
  token: 'share_token',
  label: 'Reviewer',
  created_at: '2026-08-26T12:00:00Z',
  expires_at: null,
}
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
  it('returns central GET through the safe proxy without rebuilding Backend headers', async () => {
    vi.mocked(getRuntime).mockResolvedValue({
      config: { central: { hosts: [] }, projects: [] },
    } as never)
    vi.mocked(proxyCentralApiRequest).mockResolvedValue(
      Response.json({ shares: [RECORD] }, { headers: { 'cache-control': 'no-store' } }),
    )
    const req = new NextRequest(
      'https://memon.example.test/api/projects/shared-project/shares?host=host-a&reveal=true',
    )
    const response = await GET(req, {
      params: Promise.resolve({ project: 'shared-project' }),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(proxyCentralApiRequest).toHaveBeenCalledWith(
      req,
      expect.objectContaining({ actor: { role: 'owner' } }),
    )
  })

  it('rewrites Backend records to the central Host-qualified public URL', async () => {
    vi.mocked(getRuntime).mockResolvedValue({
      config: { central: { hosts: [] }, projects: [] },
    } as never)
    vi.mocked(proxyCentralApiRequest).mockImplementation(async (req) => {
      const host = new URL(req.url).searchParams.get('host')
      return Response.json(
        { share: { ...RECORD, token: `share_for_${host}` } },
        {
          status: 201,
          headers: { location: 'https://backend.internal/private-share-url' },
        },
      )
    })

    for (const host of ['host-a', 'host-b']) {
      const response = await POST(request(host), {
        params: Promise.resolve({ project: 'shared-project' }),
      })
      expect(response.status).toBe(201)
      const body = await response.json()
      expect(body.share.share_url).toBe(
        `https://memon.example.test/share/${host}/shared-project/share_for_${host}`,
      )
      expect(JSON.stringify(body)).not.toContain('backend.internal')
    }
    expect(proxyCentralApiRequest).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({ actor: { role: 'owner' } }),
    )
  })

  it('requires an exact central Host selector', async () => {
    vi.mocked(getRuntime).mockResolvedValue({
      config: { central: { hosts: [] }, projects: [] },
    } as never)
    const response = await POST(request(), {
      params: Promise.resolve({ project: 'shared-project' }),
    })
    expect(response.status).toBe(400)
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
