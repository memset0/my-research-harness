// v3-spec-sync task 2.3.4 — anomaly banner copy-all writes structured payload
//
// Decision: vitest + RTL. The flow is purely component-state plus a
// `navigator.clipboard.writeText` call; no real browser network or
// clipboard interaction is needed. We mock fetchAnomalies + clipboard.

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithQuery } from '../utils'
import { AnomalyBanner } from '../../components/anomaly-banner'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return {
    ...actual,
    fetchAnomalies: vi.fn(),
  }
})

import { fetchAnomalies } from '../../lib/api'

const SAMPLE_ANOMALIES = {
  anomalies: [
    {
      code: 'ORPHAN_RUN' as const,
      project: 'project-a',
      runId: 'foo-260501-100000',
      experimentId: null,
      message: 'run "foo-260501-100000" has no experiment binding',
      detectedAt: '2026-05-06T10:00:00+08:00',
    },
    {
      code: 'PHANTOM_RUN_REF' as const,
      project: 'project-a',
      runId: 'ghost-260601-200000',
      experimentId: 'E0001-foo',
      message: 'experiment E0001-foo lists run "ghost-260601-200000" but the run dir was not discovered',
      detectedAt: '2026-05-06T10:00:00+08:00',
    },
  ],
}

describe('AnomalyBanner — Copy all writes structured payload', () => {
  let writeText: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fetchAnomalies).mockResolvedValue(SAMPLE_ANOMALIES)
    sessionStorage.clear()
    writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, {
      clipboard: { writeText },
    })
  })

  it('renders one row per anomaly + Copy all writes a structured text payload', async () => {
    renderWithQuery(<AnomalyBanner project="project-a" />)

    // Wait for the query to resolve and the banner to render.
    await waitFor(() => {
      expect(screen.getByText(/2 issues need resolution/i)).toBeInTheDocument()
    })
    expect(screen.getByText('ORPHAN_RUN')).toBeInTheDocument()
    expect(screen.getByText('PHANTOM_RUN_REF')).toBeInTheDocument()

    // Click Copy all
    fireEvent.click(screen.getByRole('button', { name: /copy all/i }))

    expect(writeText).toHaveBeenCalledTimes(1)
    const written = writeText.mock.calls[0]![0]! as string
    // Payload includes both anomaly codes + project name + at least
    // one of the messages.
    expect(written).toContain('ORPHAN_RUN')
    expect(written).toContain('PHANTOM_RUN_REF')
    expect(written).toContain('project-a')
    expect(written).toContain('foo-260501-100000')
  })

  it('hides the banner when there are zero anomalies', async () => {
    vi.mocked(fetchAnomalies).mockResolvedValue({ anomalies: [] })
    const { container } = renderWithQuery(<AnomalyBanner project="project-a" />)
    await waitFor(() => {
      expect(container.firstChild).toBeNull()
    })
  })
})
