import { ProjectRefSchema } from '@memon/core'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExperimentPage } from '../../components/experiment-page'
import { renderWithQuery } from '../utils'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return {
    ...actual,
    fetchExperimentDoc: vi.fn(),
    fetchExperimentResults: vi.fn(),
    fetchExperiment: vi.fn(),
    fetchRunFiles: vi.fn(),
    patchExperimentStatusV4: vi.fn(),
  }
})

import { fetchExperimentDoc, fetchExperimentResults, patchExperimentStatusV4 } from '../../lib/api'

const EXP_ID = 'E0001-structured'
const CENTRAL_PROJECT = ProjectRefSchema.parse({ host: 'host-a', project: 'research' })

describe('ExperimentPage v6 document sections', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects a Host-qualified current payload that is missing the v6 document contract', async () => {
    vi.mocked(fetchExperimentDoc).mockResolvedValue({ id: EXP_ID } as never)
    renderWithQuery(
      <ExperimentPage project={CENTRAL_PROJECT} experimentId={EXP_ID} initialOpenRun={null} />,
    )

    expect(
      await screen.findByText(/missing the required v6 managed-document contract/i),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Plan' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Caveats' })).not.toBeInTheDocument()
  })

  it('renders YAML Markdown, unsupported source, and managed conflicts without hiding content', async () => {
    vi.mocked(patchExperimentStatusV4).mockResolvedValue({ mtime: 2 })
    vi.mocked(fetchExperimentDoc).mockResolvedValue({
      id: EXP_ID,
      project: 'research',
      path: `/project/docs/experiments/${EXP_ID}/README.md`,
      mtime: 9,
      readmeMtime: 1,
      frontMatter: {
        id: EXP_ID,
        slug: 'structured',
        title: 'Structured experiment',
        status: 'OPEN',
        archived: false,
        runs: [],
        hypotheses: [],
        tags: [],
        createdAt: '2026-08-10T00:00:00+00:00',
        updatedAt: '2026-08-10T00:00:00+00:00',
      },
      sections: {
        motivation: null,
        method: null,
        plan: null,
        conclusion: null,
        caveats: null,
      },
      rawSections: [],
      warningsRaw: null,
      parseErrors: [],
      parseWarnings: [],
      effectiveCreatedAt: '2026-08-10T00:00:00+00:00',
      effectiveUpdatedAt: '2026-08-10T00:00:00+00:00',
      memberRuns: [],
      resultsUpdatedAt: '2026-08-23T03:00:00.000Z',
      documents: {
        implementation: {
          kind: 'implementation',
          fileName: 'implementation.yaml',
          resource: `docs/experiments/${EXP_ID}/implementation.yaml`,
          exists: true,
          data: {
            schemaVersion: 1,
            items: [
              {
                id: 'IMP0001',
                title: 'Build the structured reader',
                status: 'IN_PROGRESS',
                dependsOn: [],
                acceptanceCriteria: ['The YAML projection renders as structured UI'],
                files: ['apps/web/components/experiment-page.tsx'],
                commits: [],
                codeReviews: [],
                children: [],
              },
            ],
          },
          parseErrors: [],
          parseWarnings: [],
        },
        investigation: {
          kind: 'investigation',
          fileName: 'investigation.yaml',
          resource: `docs/experiments/${EXP_ID}/investigation.yaml`,
          exists: true,
          data: null,
          parseErrors: [],
          parseWarnings: [],
        },
        results: {
          kind: 'results',
          fileName: 'results.yaml',
          resource: `docs/experiments/${EXP_ID}/results.yaml`,
          exists: true,
          data: {
            schemaVersion: 1,
            columns: [
              { key: 'precision', label: 'Precision', group: 'parameter', type: 'string' },
              { key: 'loss', label: 'Final loss', group: 'metric', type: 'number' },
            ],
            variants: [
              {
                id: 'V0001',
                name: 'BF16',
                status: 'PLANNED',
                parameters: { precision: 'bf16' },
                metrics: { loss: null },
                runs: [],
                attempts: [],
              },
            ],
          },
          parseErrors: [],
          parseWarnings: [],
        },
      },
      documentReadOnly: true,
      documentDiagnostics: [],
      documentSections: [
        {
          heading: 'Implementation',
          body: '- **IMP0001** `[IN_PROGRESS]` Build the structured reader',
          rawBody:
            '> Managed in [implementation.yaml](./implementation.yaml); read and update that file directly.',
          index: 0,
          occurrence: 1,
          supported: true,
          managed: true,
          pointerValid: true,
          source: 'yaml',
          diagnostics: [],
        },
        {
          heading: 'Results',
          body: '| Variant | Status |\n| --- | --- |\n| **V0001** BF16 | `PLANNED` |',
          rawBody:
            '> Managed in [results.yaml](./results.yaml); read and update that file directly.',
          index: 0,
          occurrence: 1,
          supported: true,
          managed: true,
          pointerValid: true,
          source: 'yaml',
          diagnostics: [],
        },
        {
          heading: 'Legacy Notes',
          body: 'Evidence that must stay visible.',
          rawBody: 'Evidence that must stay visible.',
          index: 1,
          occurrence: 1,
          supported: false,
          managed: false,
          pointerValid: null,
          source: 'readme',
          diagnostics: [
            {
              code: 'UNKNOWN_H2_SECTION',
              severity: 'error',
              file: 'README.md',
              field: 'section.Legacy Notes',
              message: 'unsupported heading',
            },
          ],
        },
        {
          heading: 'Investigation',
          body: '- [ ] Original checklist that conflicts with the managed pointer',
          rawBody: '- [ ] Original checklist that conflicts with the managed pointer',
          index: 2,
          occurrence: 1,
          supported: true,
          managed: true,
          pointerValid: false,
          source: 'readme',
          diagnostics: [
            {
              code: 'MANAGED_SECTION_NOT_STUB',
              severity: 'error',
              file: 'README.md',
              field: 'section.Investigation',
              message: 'managed section must contain its pointer',
            },
          ],
        },
      ],
    })

    let resolveRefresh: (snapshot: Awaited<ReturnType<typeof fetchExperimentResults>>) => void =
      () => undefined
    vi.mocked(fetchExperimentResults).mockReturnValue(
      new Promise((resolve) => {
        resolveRefresh = resolve
      }),
    )

    const { container } = renderWithQuery(
      <ExperimentPage project={CENTRAL_PROJECT} experimentId={EXP_ID} initialOpenRun={null} />,
    )

    await waitFor(() => expect(screen.getByText('Structured experiment')).toBeInTheDocument())
    expect(screen.getByText('V0001')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Build the structured reader' })).toBeInTheDocument()
    expect(container.querySelector('[data-slot="implementation-document"]')).toBeInTheDocument()
    expect(screen.getByText('Evidence that must stay visible.')).toBeInTheDocument()
    expect(screen.getByText('Unsupported')).toBeInTheDocument()
    expect(screen.getByText('Managed section conflict')).toBeInTheDocument()
    expect(screen.getByText(/Original checklist that conflicts/)).toBeInTheDocument()
    expect(container.querySelectorAll('input[type="checkbox"][disabled]')).toHaveLength(1)
    expect(container.querySelector('[data-slot="results-table"]')).toBeInTheDocument()
    const sectionOrder = Array.from(container.querySelectorAll('[data-section-heading]')).map(
      (element) => element.getAttribute('data-section-heading'),
    )
    expect(sectionOrder[0]).toBe('Results')
    expect(sectionOrder.indexOf('Results')).toBeLessThan(sectionOrder.indexOf('Implementation'))
    expect(sectionOrder.at(-1)).toBe('Runs')
    expect(screen.getByText(/^compatibility view$/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /edit markdown/i })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /change experiment status/i })).toBeInTheDocument()
    expect(fetchExperimentResults).not.toHaveBeenCalled()
    expect(screen.getByText(/Last updated/)).toBeInTheDocument()
    expect(screen.getByText(/Stale for/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show Final loss column' }))
    expect(screen.getByRole('checkbox', { name: 'Show Final loss column' })).not.toBeChecked()
    expect(screen.queryByRole('columnheader', { name: /Final loss/ })).not.toBeInTheDocument()

    const refreshButton = screen.getByRole('button', { name: 'Refresh Results' })
    await userEvent.click(refreshButton)
    expect(fetchExperimentResults).toHaveBeenCalledTimes(1)
    expect(refreshButton).toBeDisabled()
    expect(refreshButton).toHaveTextContent('Refreshing…')
    expect(screen.getByText('Evidence that must stay visible.')).toBeInTheDocument()

    const refreshedUpdatedAt = new Date(Date.now() - 60 * 60 * 1_000).toISOString()
    resolveRefresh({
      project: 'research',
      resource: `docs/experiments/${EXP_ID}/results.yaml`,
      document: {
        schemaVersion: 1,
        columns: [
          { key: 'precision', label: 'Precision', group: 'parameter', type: 'string' },
          { key: 'loss', label: 'Final loss', group: 'metric', type: 'number' },
          { key: 'throughput', label: 'Throughput', group: 'metric', type: 'number' },
        ],
        variants: [
          {
            id: 'V0002',
            name: 'FP32 refreshed',
            status: 'COMPLETED',
            parameters: { precision: 'fp32' },
            metrics: { loss: 0.125, throughput: 42 },
            runs: [],
            attempts: [],
          },
        ],
      },
      updatedAt: refreshedUpdatedAt,
      warnings: [],
    })
    await waitFor(() => expect(screen.getByText('V0002')).toBeInTheDocument())
    expect(screen.queryByText('V0001')).not.toBeInTheDocument()
    expect(screen.getByText('Evidence that must stay visible.')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Show Final loss column' })).not.toBeChecked()
    expect(screen.queryByRole('columnheader', { name: /Final loss/ })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Show Throughput column' })).toBeChecked()
    expect(screen.getByRole('columnheader', { name: /Throughput/ })).toBeInTheDocument()
    expect(container.querySelector('[data-results-snapshot-status]')).toHaveAttribute(
      'title',
      `Results last changed at ${refreshedUpdatedAt}`,
    )
    expect(container.querySelector('[data-results-stale-for]')).toHaveTextContent('Stale for 1h')

    await userEvent.click(screen.getByRole('button', { name: 'Refresh Results' }))
    await waitFor(() => expect(fetchExperimentResults).toHaveBeenCalledTimes(2))
    expect(container.querySelector('[data-results-snapshot-status]')).toHaveAttribute(
      'title',
      `Results last changed at ${refreshedUpdatedAt}`,
    )
    expect(container.querySelector('[data-results-stale-for]')).toHaveTextContent('Stale for 1h')

    vi.mocked(fetchExperimentResults).mockRejectedValueOnce(new Error('network unavailable'))
    await userEvent.click(screen.getByRole('button', { name: 'Refresh Results' }))
    await waitFor(() =>
      expect(screen.getByText('Results refresh failed: network unavailable')).toBeInTheDocument(),
    )
    expect(screen.getByText('V0002')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh Results' })).toBeEnabled()
    expect(container.querySelector('[data-results-snapshot-status]')).toHaveAttribute(
      'title',
      `Results last changed at ${refreshedUpdatedAt}`,
    )

    await userEvent.click(screen.getByRole('combobox', { name: /change experiment status/i }))
    await userEvent.click(await screen.findByRole('option', { name: 'RESOLVED' }))
    await waitFor(() =>
      expect(patchExperimentStatusV4).toHaveBeenCalledWith({
        id: EXP_ID,
        project: CENTRAL_PROJECT,
        status: 'RESOLVED',
        // `mtime` above is the newer bundle activity timestamp. Mutations
        // must lock against README.md's own timestamp instead.
        expectedMtime: 1,
      }),
    )
    expect(screen.queryByRole('heading', { name: 'Plan' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Caveats' })).not.toBeInTheDocument()
  })
})
