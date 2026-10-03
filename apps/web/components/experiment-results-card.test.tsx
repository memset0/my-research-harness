import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithHeartbeat } from '../test/utils'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, fetchExperimentResults: vi.fn() }
})

import { fetchExperimentResults } from '../lib/api'
import type {
  ExperimentDisplaySection,
  ExperimentResultsDocumentPayload,
  ResultsSummaryPayload,
} from '../lib/dto/experiments'
import { resultsDocument, variant } from '../lib/experiment-results/fixtures.test-helpers'
import { ExperimentResultsCard } from './experiment-results-card'

const EXPERIMENT = 'E0001-card'
const OK = resultsDocument([variant('V0001', { name: 'Baseline', parameters: { lr: 0.1 } })])
const SECTION: ExperimentDisplaySection = {
  heading: 'Results',
  body: '',
  rawBody: '',
  index: 0,
  occurrence: 1,
  supported: true,
  managed: true,
  pointerValid: true,
  source: 'yaml',
  diagnostics: [],
}

function failedSummary(
  code: 'RESULT_SCHEMA_MISMATCH' | 'RESULT_DUPLICATE_ROW' | 'INVALID_RESULTS' | 'RESULTS_NOT_FOUND',
  extra: Partial<NonNullable<ResultsSummaryPayload['error']>> = {},
): ResultsSummaryPayload {
  return {
    ...resultsDocument([], []),
    experimentSchemaVersion: code === 'INVALID_RESULTS' ? null : 2,
    outcome: 'failed',
    error: {
      code,
      message: `${code} for this Experiment`,
      files: [{ file: 'logs/b-260901-100000/result.csv', version: 1 }],
      ...extra,
    },
  }
}

function results(summary: ResultsSummaryPayload | null): ExperimentResultsDocumentPayload {
  return {
    kind: 'results',
    fileName: 'experiment.json',
    resource: `docs/experiments/${EXPERIMENT}/experiment.json`,
    exists: true,
    legacyResultsYaml: false,
    parseErrors: [],
    parseWarnings: [],
    summary,
  }
}

function renderCard(
  summary: ResultsSummaryPayload | null,
  updatedAt = '2026-10-01T08:00:00+08:00',
) {
  return renderWithHeartbeat(
    <ExperimentResultsCard
      section={SECTION}
      results={results(summary)}
      updatedAt={updatedAt}
      project="research"
      experimentId={EXPERIMENT}
      runIds={[]}
    />,
  )
}

describe('ExperimentResultsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Forbidden', { status: 403 })))
  })

  it('renders the first summary from the detail response without a snapshot request', () => {
    const { container } = renderCard(OK)
    expect(container.querySelector('[data-variant-id="V0001"]')).toBeInTheDocument()
    expect(container.querySelector('[data-results-snapshot-status]')).toHaveAttribute(
      'title',
      'Results inputs last changed at 2026-10-01T08:00:00+08:00',
    )
    expect(fetchExperimentResults).not.toHaveBeenCalled()
  })

  it('loads a summary deferred for size from the Results endpoint', async () => {
    const big = resultsDocument(
      Array.from({ length: 300 }, (_, index) =>
        variant(`V${String(index + 1).padStart(4, '0')}`, { name: `variant ${index + 1}` }),
      ),
    )
    vi.mocked(fetchExperimentResults).mockResolvedValue({
      ok: true,
      summary: big,
      updatedAt: '2026-10-01T08:00:00+08:00',
    })
    const { container } = renderWithHeartbeat(
      <ExperimentResultsCard
        section={SECTION}
        results={{ ...results(null), summaryDeferred: { bytes: 2_000_000, limit: 262_144 } }}
        updatedAt="2026-10-01T08:00:00+08:00"
        project="research"
        experimentId={EXPERIMENT}
        runIds={[]}
      />,
    )
    expect(container.querySelector('[data-results-deferred-loading]')).toBeInTheDocument()
    await waitFor(() =>
      expect(container.querySelector('[data-variant-id="V0001"]')).toBeInTheDocument(),
    )
    expect(fetchExperimentResults).toHaveBeenCalledTimes(1)
    expect(fetchExperimentResults).toHaveBeenCalledWith('research', EXPERIMENT)
    expect(container.querySelector('[data-results-deferred-loading]')).toBeNull()
  })

  it.each([
    ['RESULT_SCHEMA_MISMATCH', 'records version 1'],
    ['RESULT_DUPLICATE_ROW', 'logs/b-260901-100000/result.csv'],
  ] as const)('replaces the table with the blocking %s error card', (code, text) => {
    const { container } = renderCard(
      failedSummary(code, {
        ...(code === 'RESULT_SCHEMA_MISMATCH'
          ? { upgradeCommand: `memon experiment schema upgrade ${EXPERIMENT} --to 2` }
          : {}),
      }),
    )
    const card = container.querySelector('[data-slot="results-error"]')!
    expect(card).toHaveAttribute('data-error-code', code)
    expect(card).toHaveTextContent(text)
    expect(container.querySelector('[data-variant-id]')).toBeNull()
    expect(container.querySelector('table')).toBeNull()
    if (code === 'RESULT_SCHEMA_MISMATCH')
      expect(container.querySelector('[data-slot="results-upgrade-command"]')).toHaveTextContent(
        `memon experiment schema upgrade ${EXPERIMENT} --to 2`,
      )
  })

  it('shows an invalid description file as an error card when no table was shown yet', () => {
    const { container } = renderCard(failedSummary('INVALID_RESULTS'))
    expect(container.querySelector('[data-slot="results-error"]')).toHaveAttribute(
      'data-error-code',
      'INVALID_RESULTS',
    )
  })

  it('keeps the last good table and time when a refresh finds the description file invalid', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchExperimentResults).mockResolvedValueOnce({
      ok: false,
      status: 400,
      message: 'experiment.json is not valid JSON',
      body: {
        error: { code: 'INVALID_RESULTS', message: 'experiment.json is not valid JSON' },
        files: [],
        diagnostics: [],
        updatedAt: '2026-10-02T09:00:00+08:00',
      },
    })
    const { container } = renderCard(OK)
    await user.click(screen.getByRole('button', { name: 'Refresh Results' }))
    expect(
      await screen.findByText(/INVALID_RESULTS: experiment.json is not valid JSON/),
    ).toBeInTheDocument()
    expect(container.querySelector('[data-variant-id="V0001"]')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="results-error"]')).toBeNull()
    expect(container.querySelector('[data-results-snapshot-status]')).toHaveAttribute(
      'title',
      'Results inputs last changed at 2026-10-01T08:00:00+08:00',
    )
    expect(screen.getByRole('button', { name: 'Refresh Results' })).toBeEnabled()
  })

  it('replaces the table on a refreshed schema mismatch and recovers once the inputs agree', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchExperimentResults)
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        message: 'mismatch',
        body: {
          error: { code: 'RESULT_SCHEMA_MISMATCH', message: 'mismatch' },
          files: [{ file: 'logs/b-260901-100000/result.csv', version: 1 }],
          upgradeCommand: `memon experiment schema upgrade ${EXPERIMENT} --to 2`,
          expectedVersion: 2,
          diagnostics: [],
          updatedAt: '2026-10-02T10:00:00+08:00',
        },
      })
      .mockResolvedValueOnce({ ok: true, summary: OK, updatedAt: '2026-10-02T11:00:00+08:00' })
    const { container } = renderCard(OK)
    await user.click(screen.getByRole('button', { name: 'Refresh Results' }))
    await waitFor(() =>
      expect(container.querySelector('[data-slot="results-error"]')).toBeInTheDocument(),
    )
    expect(container.querySelector('[data-variant-id]')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Refresh Results' }))
    await waitFor(() =>
      expect(container.querySelector('[data-variant-id="V0001"]')).toBeInTheDocument(),
    )
    expect(container.querySelector('[data-results-snapshot-status]')).toHaveAttribute(
      'title',
      'Results inputs last changed at 2026-10-02T11:00:00+08:00',
    )
  })
})
