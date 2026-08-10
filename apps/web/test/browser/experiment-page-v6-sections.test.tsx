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
    fetchExperiment: vi.fn(),
    fetchRunFiles: vi.fn(),
    patchExperimentStatusV4: vi.fn(),
  }
})

import { fetchExperimentDoc, patchExperimentStatusV4 } from '../../lib/api'

const EXP_ID = 'E0001-structured'

describe('ExperimentPage v6 document sections', () => {
  beforeEach(() => vi.clearAllMocks())

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
      warningsRaw: null,
      parseErrors: [],
      parseWarnings: [],
      effectiveCreatedAt: '2026-08-10T00:00:00+00:00',
      effectiveUpdatedAt: '2026-08-10T00:00:00+00:00',
      memberRuns: [],
      documentReadOnly: true,
      documentSections: [
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

    const { container } = renderWithQuery(
      <ExperimentPage project="research" experimentId={EXP_ID} initialOpenRun={null} />,
    )

    await waitFor(() => expect(screen.getByText('Structured experiment')).toBeInTheDocument())
    expect(screen.getByText('V0001')).toBeInTheDocument()
    expect(screen.getByText('Evidence that must stay visible.')).toBeInTheDocument()
    expect(screen.getByText('Unsupported')).toBeInTheDocument()
    expect(screen.getByText('Managed section conflict')).toBeInTheDocument()
    expect(screen.getByText(/Original checklist that conflicts/)).toBeInTheDocument()
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(1)
    expect(screen.getByText(/^compatibility view$/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /edit markdown/i })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /change experiment status/i })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('combobox', { name: /change experiment status/i }))
    await userEvent.click(await screen.findByRole('option', { name: 'RESOLVED' }))
    await waitFor(() =>
      expect(patchExperimentStatusV4).toHaveBeenCalledWith({
        id: EXP_ID,
        status: 'RESOLVED',
        // `mtime` above is the newer bundle activity timestamp. Mutations
        // must lock against README.md's own timestamp instead.
        expectedMtime: 1,
      }),
    )
  })
})
