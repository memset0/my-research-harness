// @vitest-environment node

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addShare } from '@memon/core'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/server/runtime', () => ({ getRuntime: vi.fn() }))
vi.mock('@/lib/server/central/fleet-runtime', () => ({ getCentralFleet: vi.fn() }))
vi.mock('@/lib/server/central/backend-proxy', () => ({ proxyCentralApiRequest: vi.fn() }))

import { proxyCentralApiRequest } from '@/lib/server/central/backend-proxy'
import { getCentralFleet } from '@/lib/server/central/fleet-runtime'
import { getRuntime } from '@/lib/server/runtime'
import { DELETE } from './route'

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-share-revoke-route-'))
  vi.clearAllMocks()
  vi.mocked(getRuntime).mockResolvedValue({
    config: { central: { hosts: [] }, projects: [] },
  } as never)
  vi.mocked(getCentralFleet).mockResolvedValue({ registry: { marker: 'registry' } } as never)
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('central share revoke composition', () => {
  it('routes the exact Host, Project, and share ID through the safe proxy', async () => {
    vi.mocked(proxyCentralApiRequest).mockResolvedValue(
      Response.json({ revoked: [{ id: 'shr_abcdefgh' }] }),
    )
    const request = new NextRequest(
      'https://memon.example.test/api/projects/shared-project/shares/shr_abcdefgh?host=host-b',
      { method: 'DELETE' },
    )
    const response = await DELETE(request, {
      params: Promise.resolve({ project: 'shared-project', id: 'shr_abcdefgh' }),
    })
    expect(response.status).toBe(200)
    expect(proxyCentralApiRequest).toHaveBeenCalledWith(request, {
      registry: { marker: 'registry' },
      actor: { role: 'owner' },
    })
  })

  it('rejects a missing Host before proxying', async () => {
    const response = await DELETE(
      new NextRequest(
        'https://memon.example.test/api/projects/shared-project/shares/shr_abcdefgh',
        { method: 'DELETE' },
      ),
      { params: Promise.resolve({ project: 'shared-project', id: 'shr_abcdefgh' }) },
    )
    expect(response.status).toBe(400)
    expect(proxyCentralApiRequest).not.toHaveBeenCalled()
  })

  it('keeps standalone revoke behavior through the configured service composition', async () => {
    const record = await addShare(root, { label: 'Reviewer' })
    vi.mocked(getRuntime).mockResolvedValue({
      config: { projects: [{ name: 'shared-project', root }] },
    } as never)

    const response = await DELETE(
      new NextRequest(
        `https://memon.example.test/api/projects/shared-project/shares/${record.id}`,
        { method: 'DELETE' },
      ),
      { params: Promise.resolve({ project: 'shared-project', id: record.id }) },
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      revoked: [expect.objectContaining({ id: record.id })],
    })
    expect(proxyCentralApiRequest).not.toHaveBeenCalled()
  })
})
