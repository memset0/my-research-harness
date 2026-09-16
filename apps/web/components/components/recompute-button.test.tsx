import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runComponents } from '../../lib/api'
import { renderWithQuery } from '../../test/utils'
import { RecomputeButton } from './recompute-button'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, runComponents: vi.fn() }
})
vi.mock('../session-provider', () => ({ useIsOwner: () => true }))

const block = {
  type: 'datatable', version: 1, id: 'metrics', line: 1, payload: 'script: collect.py::main', executable: true,
  document: { project: 'project-a', path: 'docs/wiki/note/W1.md' }, resourceUrl: () => null,
}

beforeEach(() => vi.mocked(runComponents).mockReset())

describe('RecomputeButton', () => {
  it.each(['updated', 'unchanged'] as const)('reports %s and invalidates the cache query', async (status) => {
    vi.mocked(runComponents).mockResolvedValue({ results: [{ id: 'metrics', status, path: 'docs/wiki/note/W1__assets/metrics.json', durationMs: 2 }] })
    const { queryClient } = renderWithQuery(<RecomputeButton block={block} />)
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    await userEvent.click(screen.getByRole('button', { name: 'recompute' }))
    await waitFor(() => expect(screen.getByRole('button', { name: status })).toBeInTheDocument())
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['doc-asset', 'project-a', null, 'docs/wiki/note/W1__assets/metrics.json'] })
  })

  it('shows a failed result error without invalidating cache', async () => {
    vi.mocked(runComponents).mockResolvedValue({ results: [{ id: 'metrics', status: 'failed', path: 'docs/wiki/note/W1__assets/metrics.json', durationMs: 2, error: 'collector exploded' }] })
    const { queryClient } = renderWithQuery(<RecomputeButton block={block} />)
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    await userEvent.click(screen.getByRole('button', { name: 'recompute' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('collector exploded')
    expect(screen.getByRole('button', { name: 'failed' })).toBeInTheDocument()
    expect(invalidate).not.toHaveBeenCalled()
  })
})
