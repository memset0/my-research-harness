// v3-spec-sync task 2.3.5 — run-panel expand persists across reload
//
// Decision: vitest + RTL. We render `ExperimentPage` with mocked queries,
// expand a run panel, simulate a reload (full unmount + render), and
// assert the panel is open via the localStorage key
// `memon:exp-page:<exp>:<run>:open`.
//
// The localStorage write happens inside `setOpenAndPersist`; on remount
// the same key is read in a `useEffect` and the panel auto-opens.

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
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

import { fetchExperimentDoc, fetchExperiment } from '../../lib/api'

const EXP_ID = 'E0001-foo'
const RUN_ID = 'foo-260501-100000'

const SAMPLE_EXP = {
  id: EXP_ID,
  project: 'project-a',
  path: `/p/a/docs/experiments/${EXP_ID}.md`,
  mtime: 1000,
  frontMatter: {
    id: EXP_ID,
    slug: 'foo',
    title: 'Foo study',
    runs: [RUN_ID],
    hypotheses: [],
    tags: [],
    createdAt: '2026-05-01T08:00:00+08:00',
    updatedAt: '2026-05-01T08:00:00+08:00',
  },
  sections: { motivation: null, method: null, plan: null, conclusion: null, caveats: null },
  warningsRaw: null,
  parseErrors: [],
  parseWarnings: [],
  effectiveCreatedAt: '2026-05-01T08:00:00+08:00',
  effectiveUpdatedAt: '2026-05-01T08:00:00+08:00',
  memberRuns: [
    {
      id: RUN_ID,
      status: 'FINISHED',
      createdAt: '2026-05-01T10:00:00+08:00',
      updatedAt: '2026-05-01T11:30:00+08:00',
      finishedAt: '2026-05-01T11:30:00+08:00',
      host: 'gpu-04',
      gpus: [0],
      path: `/p/a/logs/${RUN_ID}`,
      artifacts: [] as Array<{ path: string; description: string }>,
    },
  ],
}

const SAMPLE_RUN = {
  id: RUN_ID,
  project: 'project-a',
  path: `/p/a/logs/${RUN_ID}`,
  mtime: 1000,
  hasReadme: true,
  frontMatter: {
    id: RUN_ID,
    name: 'foo',
    project: '',
    status: 'FINISHED' as const,
    experiment: EXP_ID,
    createdAt: '2026-05-01T10:00:00+08:00',
    updatedAt: '2026-05-01T11:30:00+08:00',
    finishedAt: '2026-05-01T11:30:00+08:00',
    host: 'gpu-04',
    pid: null,
    gpus: [0],
    entry: './run.sh',
    command: 'bash run.sh',
    wandb: null,
    hypotheses: [],
    tags: [],
  },
  sections: {
    motivation: null,
    setup: 'Setup line.',
    method: null,
    result: 'Result line.',
    conclusion: null,
    caveats: null,
    artifacts: [],
    newHypotheses: null,
  },
  warnings: [],
  warningsRaw: null,
  body: '',
  parseErrors: [],
  parseWarnings: [],
  stale: false,
  resources: null,
}

describe('ExperimentPage — run panel expand persists across reload', () => {
  const STORAGE_KEY = `memon:exp-page:${EXP_ID}:${RUN_ID}:open`

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fetchExperimentDoc).mockResolvedValue(SAMPLE_EXP)
    vi.mocked(fetchExperiment).mockResolvedValue(SAMPLE_RUN)
    localStorage.clear()
  })

  it('writes open=1 to localStorage when the user expands the panel', async () => {
    const { unmount } = renderWithQuery(
      <ExperimentPage project="project-a" experimentId={EXP_ID} initialOpenRun={null} />,
    )

    // Wait for the exp doc to load + the run panel summary to render.
    await waitFor(() => {
      expect(screen.getByText(RUN_ID)).toBeInTheDocument()
    })

    // The trigger row is a Radix CollapsibleTrigger (rendered as a
    // role="button" div via asChild). Clicking it toggles open and
    // setOpenAndPersist writes to localStorage.
    const trigger = screen.getByText(RUN_ID).closest('[data-state]') as HTMLElement | null
    expect(trigger).not.toBeNull()
    fireEvent.click(trigger!)

    await waitFor(() => {
      expect(localStorage.getItem(STORAGE_KEY)).toBe('1')
    })

    unmount()
  })

  it('auto-opens the panel on remount when localStorage[key]=1', async () => {
    localStorage.setItem(STORAGE_KEY, '1')

    renderWithQuery(
      <ExperimentPage project="project-a" experimentId={EXP_ID} initialOpenRun={null} />,
    )

    // The trigger is rendered and the panel content (including the
    // RunBody data fetched via fetchExperiment) appears once open.
    await waitFor(() => {
      expect(screen.getByText(RUN_ID)).toBeInTheDocument()
    })
    // The run-body content (which only mounts when the panel is
    // expanded) carries the run's command value. If persistence works
    // we see this without clicking.
    await waitFor(() => {
      expect(screen.getByText('bash run.sh')).toBeInTheDocument()
    })
  })
})
