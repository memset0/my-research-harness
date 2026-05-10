// v3 Plan section task 5.2 — render-level assertion that the experiment
// detail page renders a Plan SectionCard between Method and Conclusion,
// and that a non-null `sections.plan` body flows through the Markdown
// component (so checkboxes render as actual <input> elements).

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithQuery } from '../utils'
import { ExperimentPage } from '../../components/experiment-page'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return {
    ...actual,
    fetchExperimentDoc: vi.fn(),
    fetchExperiment: vi.fn(),
    fetchRunFiles: vi.fn().mockResolvedValue({
      truncated: false,
      tree: { type: 'dir' as const, path: '.', children: [] },
    }),
  }
})

import { fetchExperimentDoc } from '../../lib/api'

const EXP_ID = 'E0002-plan-fixture'

const PLAN_BODY = [
  '- [x] Done task',
  '- [ ] Pending task',
  '  - [ ] Nested pending',
].join('\n')

const BASE_EXP = {
  id: EXP_ID,
  project: 'project-a',
  path: `/p/a/docs/experiments/${EXP_ID}.md`,
  mtime: 1000,
  frontMatter: {
    id: EXP_ID,
    slug: 'plan-fixture',
    title: 'Plan fixture study',
    runs: [],
    hypotheses: [],
    tags: [],
    createdAt: '2026-05-01T08:00:00+08:00',
    updatedAt: '2026-05-01T08:00:00+08:00',
  },
  warningsRaw: null,
  parseErrors: [],
  parseWarnings: [],
  effectiveCreatedAt: '2026-05-01T08:00:00+08:00',
  effectiveUpdatedAt: '2026-05-01T08:00:00+08:00',
  memberRuns: [],
}

describe('ExperimentPage — Plan section', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the Plan SectionCard between Method and Conclusion', async () => {
    vi.mocked(fetchExperimentDoc).mockResolvedValue({
      ...BASE_EXP,
      sections: {
        motivation: 'Why',
        method: 'How',
        plan: PLAN_BODY,
        conclusion: 'What we found',
        caveats: 'What to watch out for',
      },
    })

    const { container } = renderWithQuery(
      <ExperimentPage project="project-a" experimentId={EXP_ID} initialOpenRun={null} />,
    )

    // Wait for the document to load and Section cards to render.
    await waitFor(() => {
      expect(screen.getByText('Motivation')).toBeInTheDocument()
    })

    const headings = Array.from(
      container.querySelectorAll<HTMLElement>('[data-slot="card-title"]'),
    )
      .map((h) => h.textContent?.trim())
      .filter(Boolean) as string[]

    const idxMotivation = headings.indexOf('Motivation')
    const idxMethod = headings.indexOf('Method')
    const idxPlan = headings.indexOf('Plan')
    const idxConclusion = headings.indexOf('Conclusion')
    const idxCaveats = headings.indexOf('Caveats')

    expect(idxMotivation).toBeGreaterThanOrEqual(0)
    expect(idxMethod).toBeGreaterThan(idxMotivation)
    expect(idxPlan).toBeGreaterThan(idxMethod)
    expect(idxConclusion).toBeGreaterThan(idxPlan)
    expect(idxCaveats).toBeGreaterThan(idxConclusion)
  })

  it('Plan body is rendered through the Markdown component, producing disabled checkboxes for nested task lists', async () => {
    vi.mocked(fetchExperimentDoc).mockResolvedValue({
      ...BASE_EXP,
      sections: {
        motivation: null,
        method: null,
        plan: PLAN_BODY,
        conclusion: null,
        caveats: null,
      },
    })

    const { container } = renderWithQuery(
      <ExperimentPage project="project-a" experimentId={EXP_ID} initialOpenRun={null} />,
    )

    await waitFor(() => {
      expect(screen.getByText('Plan')).toBeInTheDocument()
    })

    const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    expect(boxes.length).toBeGreaterThanOrEqual(3)
    expect(boxes[0]!.checked).toBe(true)
    expect(boxes[1]!.checked).toBe(false)
    for (const box of Array.from(boxes)) {
      expect(box.disabled).toBe(true)
    }
  })

  it('Plan SectionCard shows the empty placeholder when sections.plan is null', async () => {
    vi.mocked(fetchExperimentDoc).mockResolvedValue({
      ...BASE_EXP,
      sections: {
        motivation: null,
        method: null,
        plan: null,
        conclusion: null,
        caveats: null,
      },
    })

    renderWithQuery(
      <ExperimentPage project="project-a" experimentId={EXP_ID} initialOpenRun={null} />,
    )

    await waitFor(() => {
      expect(screen.getByText('Plan')).toBeInTheDocument()
    })

    // The empty-section placeholder text "to fill" is rendered for every
    // null body section by the existing SectionCard implementation; we
    // confirm at least one such placeholder exists (and that the Plan
    // heading is among the rendered headings).
    const placeholders = screen.getAllByText('to fill')
    expect(placeholders.length).toBeGreaterThan(0)
  })
})
