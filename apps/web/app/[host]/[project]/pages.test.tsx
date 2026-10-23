import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND')
  }),
}))
const { resolveExperimentNumber, show } = vi.hoisted(() => ({
  resolveExperimentNumber: vi.fn(),
  show:
    (name: string) =>
    (props: Record<string, unknown>): React.ReactElement => (
      <pre data-testid={name}>{JSON.stringify(props)}</pre>
    ),
}))
vi.mock('@/lib/server/experiment-number', () => ({ resolveExperimentNumber }))
vi.mock('@/components/experiment-card-grid', () => ({ ExperimentCardGrid: show('grid') }))
vi.mock('@/components/experiment-page', () => ({ ExperimentPage: show('experiment') }))
vi.mock('@/components/inbox-shell', () => ({ InboxShell: show('inbox') }))
vi.mock('@/components/wiki-shell', () => ({ WikiShell: show('wiki') }))
vi.mock('@/components/code-review-detail', () => ({ CodeReviewDetail: show('review') }))

import ProjectReviewPage from './cr/[key]/page'
import ExperimentReviewPage from './e/[n]/cr/[key]/page'
import ExperimentPage from './e/[n]/page'
import ExperimentsPage from './experiments/page'
import OverviewPage from './page'
import ReportPage from './r/[n]/page'
import WikiPage from './w/[n]/page'

const project = { host: 'host-a', project: 'project-a' }
const params = <T extends object>(extra: T) => Promise.resolve({ ...project, ...extra })
const props = (testId: string) => JSON.parse(screen.getByTestId(testId).textContent ?? '{}')

describe('canonical project pages', () => {
  beforeEach(() => resolveExperimentNumber.mockReset())

  it('renders the overview at the root and at /experiments', async () => {
    const view = render(await OverviewPage({ params: params({}) }))
    expect(props('grid')).toEqual({ project })
    view.unmount()
    render(await ExperimentsPage({ params: params({}) }))
    expect(props('grid')).toEqual({ project })
  })

  it('resolves an Experiment number before rendering', async () => {
    resolveExperimentNumber.mockResolvedValue({ kind: 'found', id: 'E0010-inference-kernels' })
    render(
      await ExperimentPage({
        params: params({ n: '10' }),
        searchParams: Promise.resolve({ run: 'run-1' }),
      }),
    )
    expect(resolveExperimentNumber).toHaveBeenCalledWith(project, 10)
    expect(props('experiment')).toEqual({
      project,
      experimentId: 'E0010-inference-kernels',
      initialOpenRun: 'run-1',
    })
  })

  it('reports a duplicate Experiment number without picking one', async () => {
    resolveExperimentNumber.mockResolvedValue({ kind: 'duplicate', ids: ['E0010-a', 'E0010-b'] })
    render(await ExperimentPage({ params: params({ n: '10' }), searchParams: Promise.resolve({}) }))
    expect(screen.getByRole('heading')).toHaveTextContent('Experiment number 10 is ambiguous')
    expect(screen.getByText('docs/experiments/E0010-a')).toBeInTheDocument()
    expect(screen.getByText('docs/experiments/E0010-b')).toBeInTheDocument()
    expect(screen.queryByTestId('experiment')).toBeNull()
  })

  it('says the catalog is unavailable instead of answering not-found', async () => {
    resolveExperimentNumber.mockResolvedValue({ kind: 'unavailable' })
    render(await ExperimentPage({ params: params({ n: '10' }), searchParams: Promise.resolve({}) }))
    expect(screen.getByRole('heading')).toHaveTextContent(
      'Experiment 10 is temporarily unavailable',
    )
  })

  it('answers not-found for a missing number, a padded number or a reserved Host', async () => {
    resolveExperimentNumber.mockResolvedValue({ kind: 'missing' })
    await expect(
      ExperimentPage({ params: params({ n: '99' }), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('NOT_FOUND')
    await expect(ReportPage({ params: params({ n: '0010' }) })).rejects.toThrow('NOT_FOUND')
    await expect(
      OverviewPage({ params: Promise.resolve({ host: 'login', project: 'project-a' }) }),
    ).rejects.toThrow('NOT_FOUND')
  })

  it('selects Report and Wiki pages by number', async () => {
    const view = render(await ReportPage({ params: params({ n: '7' }) }))
    expect(props('inbox')).toEqual({ kind: 'reports', project, selectedId: 'R0007' })
    view.unmount()
    render(await WikiPage({ params: params({ n: '12' }) }))
    expect(props('wiki')).toEqual({ project, selectedId: 'W0012' })
  })

  it('opens project and Experiment code reviews by date and slug', async () => {
    const view = render(
      await ProjectReviewPage({ params: params({ key: '2026-05-24-fsdp-comm-overlap' }) }),
    )
    expect(props('review')).toEqual({ project, id: 'code-review/2026-05-24-fsdp-comm-overlap' })
    view.unmount()
    resolveExperimentNumber.mockResolvedValue({ kind: 'found', id: 'E0005-bf16-flow-matching' })
    render(
      await ExperimentReviewPage({
        params: params({ n: '5', key: '2026-05-22-bf16-precision-guard' }),
      }),
    )
    expect(props('review')).toEqual({
      project,
      id: 'experiments/E0005-bf16-flow-matching/code-review/2026-05-22-bf16-precision-guard',
    })
    await expect(ProjectReviewPage({ params: params({ key: 'notes' }) })).rejects.toThrow(
      'NOT_FOUND',
    )
  })
})
