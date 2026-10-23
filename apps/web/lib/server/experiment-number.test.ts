// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const dispatch = vi.fn()
vi.mock('./runtime', () => ({ getRuntime: vi.fn(async () => ({ config: {} })) }))
vi.mock('./central/direct-runtime', () => ({
  directCentralRuntime: () => ({
    registry: { capabilities: (host: string) => (host === 'host-a' ? {} : null) },
    dispatch,
  }),
}))
vi.mock('./central/fleet-runtime', () => ({ getCentralFleet: vi.fn(async () => null) }))

import { resolveExperimentNumber } from './experiment-number'

const project = { host: 'host-a', project: 'project-a' } as never

function inventory(ids: string[]) {
  dispatch.mockResolvedValue(
    Response.json({
      items: ids.map((id) => ({ id, slug: id.slice(6), resource: `docs/experiments/${id}` })),
    }),
  )
}

describe('resolveExperimentNumber', () => {
  beforeEach(() => dispatch.mockReset())

  it('finds the one directory with the number', async () => {
    inventory(['E0001-a', 'E0010-inference-kernels', 'E0100-b'])
    await expect(resolveExperimentNumber(project, 10)).resolves.toEqual({
      kind: 'found',
      id: 'E0010-inference-kernels',
    })
    const request = dispatch.mock.calls[0]![0].request as Request
    expect(new URL(request.url).search).toBe('?host=host-a&project=project-a&inventory=1')
  })

  it('reports duplicates and missing numbers', async () => {
    inventory(['E0010-b', 'E0010-a'])
    await expect(resolveExperimentNumber(project, 10)).resolves.toEqual({
      kind: 'duplicate',
      ids: ['E0010-a', 'E0010-b'],
    })
    inventory(['E0001-a'])
    await expect(resolveExperimentNumber(project, 10)).resolves.toEqual({ kind: 'missing' })
  })

  it('reports an unreadable catalog or an unknown Host as unavailable, not missing', async () => {
    dispatch.mockResolvedValue(new Response(null, { status: 503 }))
    await expect(resolveExperimentNumber(project, 1)).resolves.toEqual({ kind: 'unavailable' })
    await expect(
      resolveExperimentNumber({ host: 'host-z', project: 'project-a' } as never, 1),
    ).resolves.toEqual({ kind: 'unavailable' })
  })
})
