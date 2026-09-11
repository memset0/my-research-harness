// Run panels on the Experiment page are lazy: the roster is the Experiment
// document's own `runs` list, and nothing about a Run is read until its panel
// is open. These tests pin the observable consequences — no Run request while
// everything is folded, exactly one Run requested when one panel opens, the
// Run readers unmounted again on collapse, and `?run=<id>` opening only its
// target.

import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExperimentPage } from '../../components/experiment-page'
import type * as ApiModule from '../../lib/api'
import { renderWithQuery } from '../utils'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>()
  return {
    ...actual,
    fetchExperimentDoc: vi.fn(),
    fetchExperiment: vi.fn(),
    fetchRunFiles: vi.fn().mockResolvedValue({
      truncated: false,
      tree: { type: 'dir' as const, resource: '.', children: [] },
    }),
  }
})

import { fetchExperiment, fetchExperimentDoc, fetchRunFiles } from '../../lib/api'

const EXP_ID = 'E0001-foo'
const RUN_A = 'foo-260501-100000'
const RUN_B = 'foo-260502-100000'

const SAMPLE_EXP = {
  id: EXP_ID,
  project: 'project-a',
  path: `/p/a/docs/experiments/${EXP_ID}.md`,
  mtime: 1000,
  readmeMtime: 1000,
  frontMatter: {
    id: EXP_ID,
    slug: 'foo',
    title: 'Foo study',
    status: 'OPEN' as const,
    archived: false,
    runs: [RUN_A, RUN_B],
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
}

function sampleRun(runId: string, command: string) {
  return {
    id: runId,
    project: 'project-a',
    path: `/p/a/logs/${runId}`,
    mtime: 1000,
    readmeMtime: 1000,
    hasReadme: true,
    frontMatter: {
      id: runId,
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
      command,
      wandb: null,
      hypotheses: [],
      tags: [],
      archived: false,
      deprecated: false,
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
}

const COMMAND_A = 'bash run-a.sh'
const COMMAND_B = 'bash run-b.sh'

function trigger(runId: string): HTMLElement {
  const row = screen.getByText(runId).closest('[data-state]')
  if (!row) throw new Error(`no collapsible trigger for ${runId}`)
  return row as HTMLElement
}

describe('ExperimentPage — Run panels read only while open', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fetchExperimentDoc).mockResolvedValue(SAMPLE_EXP as never)
    vi.mocked(fetchExperiment).mockImplementation(async (_project, id) =>
      sampleRun(id, id === RUN_A ? COMMAND_A : COMMAND_B),
    )
    vi.mocked(fetchRunFiles).mockResolvedValue({
      truncated: false,
      tree: { type: 'dir', resource: '.', children: [] },
    } as never)
    localStorage.clear()
  })

  it('lists the declared roster without reading any Run', async () => {
    renderWithQuery(
      <ExperimentPage project="project-a" experimentId={EXP_ID} initialOpenRun={null} />,
    )

    await waitFor(() => expect(screen.getByText(RUN_A)).toBeInTheDocument())
    expect(screen.getByText(RUN_B)).toBeInTheDocument()
    expect(fetchExperiment).not.toHaveBeenCalled()
    expect(fetchRunFiles).not.toHaveBeenCalled()
  })

  it('reads only the expanded Run, and stops reading it again on collapse', async () => {
    renderWithQuery(
      <ExperimentPage project="project-a" experimentId={EXP_ID} initialOpenRun={null} />,
    )
    await waitFor(() => expect(screen.getByText(RUN_A)).toBeInTheDocument())

    fireEvent.click(trigger(RUN_A))
    await waitFor(() => expect(screen.getByText(COMMAND_A)).toBeInTheDocument())

    expect(vi.mocked(fetchExperiment).mock.calls.map((call) => call[1])).toEqual([RUN_A])
    expect(vi.mocked(fetchRunFiles).mock.calls.map((call) => call[1])).toEqual([RUN_A])

    // Collapsing unmounts the body, so its log viewer and file tree stop
    // reading; the other panel was never read at all.
    fireEvent.click(trigger(RUN_A))
    await waitFor(() => expect(screen.queryByText(COMMAND_A)).not.toBeInTheDocument())
    expect(screen.queryByText(COMMAND_B)).not.toBeInTheDocument()
    expect(vi.mocked(fetchExperiment).mock.calls.map((call) => call[1])).toEqual([RUN_A])
  })

  it('expands only the ?run= target on arrival', async () => {
    renderWithQuery(
      <ExperimentPage project="project-a" experimentId={EXP_ID} initialOpenRun={RUN_B} />,
    )

    await waitFor(() => expect(screen.getByText(COMMAND_B)).toBeInTheDocument())
    expect(screen.queryByText(COMMAND_A)).not.toBeInTheDocument()
    expect(vi.mocked(fetchExperiment).mock.calls.map((call) => call[1])).toEqual([RUN_B])
  })

  it('flags a declared Run whose document cannot be read', async () => {
    vi.mocked(fetchExperiment).mockRejectedValue(new Error('run README missing'))

    renderWithQuery(
      <ExperimentPage project="project-a" experimentId={EXP_ID} initialOpenRun={RUN_A} />,
    )

    await waitFor(() => expect(screen.getByText(/could not be read/)).toBeInTheDocument())
    expect(screen.getByText(/run README missing/)).toBeInTheDocument()
  })
})
