// @vitest-environment node
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/runtime', () => ({ getRuntime: vi.fn() }))
vi.mock('../../../lib/server/standalone-services', () => ({ standaloneServices: vi.fn() }))
vi.mock('../../../lib/server/standalone-dto', () => ({
  standaloneRun: vi.fn((_config, run) => ({ ...run, path: `/root/${run.id}` })),
}))
vi.mock('@memon/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@memon/core')>()),
  BackendRunsResponseSchema: { parse: (value: unknown) => value },
}))

import { getRuntime } from '../../../lib/runtime'
import { standaloneServices } from '../../../lib/server/standalone-services'
import { GET } from './route'

const listRuns = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getRuntime).mockResolvedValue({
    config: { projects: [{ name: 'project-a' }, { name: 'project-b' }] },
  } as never)
  vi.mocked(standaloneServices).mockReturnValue({ projects: { listRuns } } as never)
  listRuns.mockImplementation(
    async (project: string, _filter: unknown, options: { inventoryOnly?: boolean }) =>
      options.inventoryOnly
        ? {
            items: [
              {
                id: `${project}-run-260908-010203`,
                slug: `${project}-run`,
                resource: `logs/${project}-run-260908-010203/README.md`,
              },
            ],
          }
        : {
            runs: [
              {
                id: `${project}-run`,
                project,
                resource: `logs/${project}-run/README.md`,
                stale: false,
              },
            ],
          },
  )
})

describe('GET /api/runs shared standalone adapter', () => {
  it('aggregates configured Projects and restores legacy path', async () => {
    const response = await GET(new NextRequest('http://localhost/api/runs'))
    expect(response.status).toBe(200)
    expect((await response.json()).experiments).toHaveLength(2)
    expect(listRuns).toHaveBeenCalledTimes(2)
  })

  it('selects one Project', async () => {
    const response = await GET(new NextRequest('http://localhost/api/runs?project=project-a'))
    expect(response.status).toBe(200)
    expect(listRuns).toHaveBeenCalledWith(
      'project-a',
      { includeDeprecated: false, deprecatedOnly: false },
      { inventoryOnly: false },
    )
    expect(listRuns).toHaveBeenCalledTimes(1)
  })

  it('forwards inventory mode without projecting rich Run records', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/runs?project=project-a&inventory=1'),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      items: [
        {
          id: 'project-a-run-260908-010203',
          slug: 'project-a-run',
          resource: 'logs/project-a-run-260908-010203/README.md',
        },
      ],
    })
    expect(listRuns).toHaveBeenCalledWith(
      'project-a',
      { includeDeprecated: false, deprecatedOnly: false },
      { inventoryOnly: true },
    )
  })
})
