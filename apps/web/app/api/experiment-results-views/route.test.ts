// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/server/runtime', () => ({ getRuntime: vi.fn() }))

import type { ExperimentResultsViewDefinition } from '@/lib/experiment-results-views'
import { encodeHostScopeHeader, HOST_SCOPE_HEADER } from '@/lib/server/auth/request-context'
import { closeExperimentResultsViewsStores } from '@/lib/server/experiment-results-views-store'
import { getRuntime } from '@/lib/server/runtime'
import { DELETE, PATCH } from './[id]/route'
import { GET, POST } from './route'

let directory: string

beforeEach(async () => {
  vi.clearAllMocks()
  directory = await mkdtemp(join(tmpdir(), 'memon-results-views-route-'))
  vi.mocked(getRuntime).mockResolvedValue({
    configPath: join(directory, 'central.yml'),
    config: { central: { hosts: [{ id: 'host-a' }, { id: 'host-b' }] }, projects: [] },
  } as unknown as Awaited<ReturnType<typeof getRuntime>>)
})

afterEach(async () => {
  await closeExperimentResultsViewsStores()
  await rm(directory, { recursive: true, force: true })
})

describe('/api/experiment-results-views', () => {
  it('shares one Experiment collection with an exact-scope viewer', async () => {
    const created = await POST(
      request('POST', 'owner', 'host-a', { name: 'Review', definition: definition() }),
    )
    expect(created.status).toBe(201)

    const response = await GET(request('GET', 'viewer', 'host-a'))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      canMutate: false,
      views: [{ name: 'Review', scope: { host: 'host-a', experimentId: 'E0001-demo' } }],
    })

    const outOfScope = await GET(request('GET', 'viewer', 'host-b'))
    expect(outOfScope.status).toBe(403)
  })

  it('rejects every viewer mutation even inside the exact read scope', async () => {
    const createdResponse = await POST(
      request('POST', 'owner', 'host-a', { name: 'Review', definition: definition() }),
    )
    const created = (await createdResponse.json()) as { view: { id: string } }

    expect(
      (
        await POST(
          request('POST', 'viewer', 'host-a', { name: 'Viewer copy', definition: definition() }),
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await PATCH(request('PATCH', 'viewer', 'host-a', { name: 'Changed' }), {
          params: Promise.resolve({ id: created.view.id }),
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await DELETE(request('DELETE', 'viewer', 'host-a'), {
          params: Promise.resolve({ id: created.view.id }),
        })
      ).status,
    ).toBe(403)

    const collection = await GET(request('GET', 'owner', 'host-a'))
    await expect(collection.json()).resolves.toMatchObject({ views: [{ name: 'Review' }] })
  })

  it('isolates identical Project and Experiment names by Host', async () => {
    await POST(request('POST', 'owner', 'host-a', { name: 'Host A', definition: definition() }))
    await POST(request('POST', 'owner', 'host-b', { name: 'Host B', definition: definition() }))

    const hostA = await GET(request('GET', 'owner', 'host-a'))
    const hostB = await GET(request('GET', 'owner', 'host-b'))
    await expect(hostA.json()).resolves.toMatchObject({ views: [{ name: 'Host A' }] })
    await expect(hostB.json()).resolves.toMatchObject({ views: [{ name: 'Host B' }] })
  })
})

function request(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  role: 'owner' | 'viewer',
  host: 'host-a' | 'host-b',
  body?: unknown,
): NextRequest {
  return new NextRequest(
    `http://localhost/api/experiment-results-views?host=${host}&project=research&experiment=E0001-demo`,
    {
      method,
      headers: {
        'x-memon-role': role,
        ...(role === 'viewer'
          ? {
              [HOST_SCOPE_HEADER]: encodeHostScopeHeader([
                { host: 'host-a', project: 'research' } as never,
              ]),
            }
          : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  )
}

function definition(): ExperimentResultsViewDefinition {
  return {
    hiddenColumnIds: [],
    columnOrderIds: ['variant', 'status'],
    maxLines: 1,
    defaultSortRules: [],
    pinnedColumnIds: { left: [], right: [] },
    rowFilters: [],
    rowOverrides: {},
    sotaModes: {},
    decimalPlaces: {},
  }
}
