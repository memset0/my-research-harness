// Render-only coverage: representative summaries render the expected
// columns, rows, cell markers and empty states. Interactive behaviour (menus,
// tooltips, hover cards, drag, typing) is deliberately not simulated here.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResultsSummaryPayload } from '../lib/dto/experiments'
import {
  column,
  resultsDocument,
  statsCell,
  valueCell,
  variant,
} from '../lib/experiment-results/fixtures.test-helpers'
import { ExperimentResultsTable } from './experiment-results-table'

const RUN_A = 'logs/run-a-261001-000000'
const RUN_B = 'logs/run-b-261001-000000'
const RUN_C = 'logs/run-c-261001-000000'

const RESULTS: ResultsSummaryPayload = resultsDocument(
  [
    variant('V0002', {
      name: 'Second declared',
      parameters: { lr: 0.002 },
      metrics: { loss: 0.2, notes: 'first line<br>second line' },
      evidence: [RUN_B, RUN_C],
    }),
    variant('V0001', {
      name: 'First by metric',
      status: 'RUNNING',
      parameters: { lr: 0.001 },
      metrics: { loss: 0.1, notes: 'single line' },
      evidence: [RUN_A],
      others: [
        {
          run: 'logs/run-failed-261001-000000',
          status: 'FAILED',
          deprecated: false,
          stopReason: null,
        },
      ],
      provenance: {
        repo: 'https://github.com/example/research.git',
        commit: '1234567890abcdef',
        entry: 'train.py',
        recipe: 'recipes/base.yaml',
      },
    }),
    variant('V0003', {
      name: 'Missing metric',
      status: 'PLANNED',
      parameters: { lr: 0.003 },
      metrics: { loss: null, notes: 'single line' },
    }),
  ],
  [
    column('params.lr', 'Learning rate'),
    column('metrics.loss', 'Final loss'),
    column('metrics.notes', 'Notes', 'string'),
  ],
)

const WANDB_URL = 'https://wandb.ai/acme/research/runs/a1b2c3d4e5f67890?nw=nwuser'
const URL_RESULTS: ResultsSummaryPayload = {
  ...RESULTS,
  columns: [...RESULTS.columns, column('metrics.tracking', 'Tracking', 'string')],
  variants: RESULTS.variants.map((row) => ({
    ...row,
    cells: {
      ...row.cells,
      'metrics.tracking': valueCell(
        row.id === 'V0002'
          ? WANDB_URL
          : row.id === 'V0001'
            ? 'https://github.com/example/research/actions/runs/1234'
            : null,
      ),
    },
  })),
}

/** Grouped parameters, a stats metric and planned / frozen / mixed cells. */
const GROUPED_RESULTS: ResultsSummaryPayload = resultsDocument(
  [
    variant('V0001', {
      name: 'Seeds',
      cells: {
        'params.optim.lr': valueCell(0.0001, { source: 'runs' }),
        'params.optim.batch_size': valueCell(32),
        'params.optim.adam.beta1': valueCell(0.9),
        'params.model.depth': valueCell(12),
        'params.seed': {
          kind: 'mixed',
          source: 'runs',
          perRun: [
            { run: RUN_A, value: 0 },
            { run: RUN_B, value: 1 },
            { run: RUN_C, value: 2 },
          ],
        },
        'metrics.eval.fid': statsCell({
          mean: 11,
          std: 1,
          n: 3,
          min: 10,
          max: 12,
          p50: 11,
          p99: 11.98,
        }),
        'metrics.eval.clip': statsCell(
          { mean: 0.312, std: 0.021, n: 500, p50: 0.31, p99: 0.4 },
          { source: 'run', over: null, across: 'sample', runs: [RUN_A] },
        ),
      },
      evidence: [RUN_A, RUN_B, RUN_C],
    }),
    variant('V0002', {
      name: 'Drifted',
      cells: {
        'params.optim.lr': valueCell(0.0002, { planned: 0.0001, differsFromPlan: true }),
        'metrics.eval.fid': valueCell(9),
        'metrics.eval.clip': statsCell(
          { mean: 0.3, std: 0.01, n: 500, p50: 0.36, p99: 0.45 },
          { source: 'run', over: null, across: 'sample', runs: [RUN_B] },
        ),
      },
    }),
    variant('V0003', {
      name: 'Historical',
      status: 'COMPLETED',
      cells: { 'metrics.eval.fid': valueCell(13.1, { source: 'frozen' }) },
    }),
    variant('V0004', {
      name: 'Waits for parent',
      status: 'BLOCKED',
      declaredStatus: 'BLOCKED',
      cells: { 'params.optim.lr': valueCell(0.0003, { source: 'planned' }) },
    }),
  ],
  [
    column('params.optim.lr', 'LR'),
    column('params.optim.batch_size', 'Batch size'),
    column('params.optim.adam.beta1', 'beta1'),
    column('params.model.depth', 'Depth'),
    column('params.seed', 'seed'),
    column('metrics.eval.fid', 'FID', 'number', {
      direction: 'lower',
      stats: ['mean', 'std', 'n', 'min', 'max', 'p50', 'p99'],
    }),
    column('metrics.eval.clip', 'CLIP', 'stats', {
      across: 'sample',
      direction: 'higher',
      stats: ['mean', 'std', 'n', 'p50', 'p99'],
      decimals: 3,
    }),
    column('env.CUDA', 'CUDA', 'string'),
  ],
  { 'params.optim': { label: 'Optimizer' } },
)

describe('ExperimentResultsTable', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: memoryStorage(),
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Forbidden', { status: 403 })))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders summary columns in order, pins the Variant column, and renders br as breaks', () => {
    const { container } = renderResults('E0001-results')
    const table = screen.getByRole('table')

    expect(headerIds(table)).toEqual([
      'variant',
      'status',
      'params.lr',
      'metrics.loss',
      'metrics.notes',
      'entry',
      'recipe',
      'commit',
      'runs',
      'attempts',
    ])
    expect(table.querySelector('thead [data-column-id="variant"]')).toHaveAttribute('rowspan', '2')
    expect(table).toHaveClass('table-auto', 'w-max', 'min-w-full')
    expect(table.parentElement).toHaveClass('overflow-x-auto')
    expect(container.querySelector('[data-max-lines="1"]')).toHaveStyle({
      maxHeight: 'calc(1 * 1.25rem)',
    })
    expect(variantOrder()).toHaveLength(3)
    expect(screen.queryByText(/<br>/)).not.toBeInTheDocument()
    const notesCell = table.querySelector(
      '[data-variant-id="V0002"] [data-column-id="metrics.notes"]',
    )
    expect(notesCell?.querySelectorAll('br')).toHaveLength(1)

    const lossHeader = table.querySelector<HTMLElement>('thead [data-column-id="metrics.loss"]')!
    expect(lossHeader).toHaveAttribute('data-column-group', 'metric')
    expect(lossHeader.querySelector('svg.lucide-chart-spline')).toBeInTheDocument()
    expect(
      table.querySelector('[data-variant-id="V0001"] [data-column-id="metrics.loss"]'),
    ).toHaveAttribute('data-column-group', 'metric')
    expect(
      container.querySelector('[data-slot="results-column-tree"] ul[aria-label="Results columns"]'),
    ).toBeInTheDocument()
  })

  it('stacks two header rows with deeper groups merged into the column name', () => {
    renderResults('E0001-headers', GROUPED_RESULTS)
    const table = screen.getByRole('table')
    const optimizerBand = table.querySelector<HTMLElement>(
      'thead [data-group-id="group:params.optim"]',
    )!
    expect(optimizerBand).toHaveTextContent('Optimizer')
    expect(optimizerBand).toHaveAttribute('colspan', '3')
    expect(
      table.querySelector('thead [data-column-id="params.optim.adam.beta1"] [data-column-label]'),
    ).toHaveTextContent('adam › beta1')
    expect(
      table.querySelector('thead [data-column-id="params.optim.lr"] [data-column-label]'),
    ).toHaveTextContent('LR')
    expect(table.querySelectorAll('thead tr')).toHaveLength(2)
  })

  it('renders stats cells and mixed, frozen, drifted, planned and BLOCKED markers', () => {
    const { container } = renderResults('E0001-stats', GROUPED_RESULTS)
    const table = screen.getByRole('table')
    const cell = (variantId: string, columnId: string) =>
      table.querySelector<HTMLElement>(
        `[data-variant-id="${variantId}"] [data-column-id="${columnId}"]`,
      )
    // Seeds aggregate by default; a one-Run stats cell reads mean ± std.
    expect(cell('V0001', 'metrics.eval.fid')).toHaveTextContent('11 ± 1 (3)')
    expect(cell('V0001', 'metrics.eval.clip')).toHaveTextContent('0.312 ± 0.021')
    expect(
      cell('V0001', 'params.seed')?.querySelector('[data-cell-marker="mixed"]'),
    ).toBeInTheDocument()
    expect(
      cell('V0003', 'metrics.eval.fid')?.querySelector('[data-cell-marker="frozen"]'),
    ).toBeInTheDocument()
    expect(
      cell('V0002', 'params.optim.lr')?.querySelector('[data-cell-marker="differs-from-plan"]'),
    ).toHaveAttribute('title', 'Differs from the planned value 0.0001')
    expect(
      cell('V0004', 'params.optim.lr')?.querySelector('[data-cell-source="planned"]'),
    ).toBeInTheDocument()
    expect(cell('V0004', 'status')?.querySelector('[data-status="BLOCKED"]')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="results-table"]')).toBeInTheDocument()
  })

  it('renders wandb.ai values as compact chart links and other URLs as text', () => {
    const { container } = renderResults('E0001-url-results', URL_RESULTS)
    const wandbLink = screen.getByRole('link', { name: 'Open W&B link a1b2c3d4e5f67890' })
    expect(wandbLink).toHaveAttribute('href', WANDB_URL)
    expect(wandbLink).toHaveAttribute('target', '_blank')
    expect(wandbLink).toHaveTextContent('a1b2c3d4e5f67890')
    const ordinaryUrlCell = container.querySelector(
      '[data-variant-id="V0001"] [data-column-id="metrics.tracking"]',
    )
    expect(ordinaryUrlCell).toHaveTextContent(
      'https://github.com/example/research/actions/runs/1234',
    )
    expect(ordinaryUrlCell?.querySelector('a')).toBeNull()
  })

  it('hides deprecated Variants by default', () => {
    const summary = structuredClone(RESULTS)
    summary.variants[0]!.deprecated = true
    const { container } = renderResults('E0001-research', summary)
    expect(container.querySelector('[data-variant-id="V0002"]')).toBeNull()
    expect(container.querySelector('[data-variant-id="V0001"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Show deprecated Variants' })).toBeInTheDocument()
  })

  it('renders the empty state when the summary has no Variants', () => {
    renderResults('E0001-empty', { ...RESULTS, variants: [] })
    expect(screen.getByText('No variants yet.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('surfaces malformed saved View settings and applies the valid saved filter', async () => {
    const experimentId = 'E0001-invalid-settings'
    window.localStorage.setItem(
      `memon:results-table:research:${experimentId}:preferences`,
      JSON.stringify({
        hiddenColumnIds: ['schema:gone'],
        statsDisplay: { 'metrics.loss': 'median' },
        rowFilters: [
          { id: 'bad', columnId: 'status', operator: 'like', value: 'RUNNING' },
          { columnId: 'status', operator: 'neq', value: 'PLANNED' },
        ],
      }),
    )
    const { container } = renderResults(experimentId)
    const note = await screen.findByRole('note')
    expect(note).toHaveAttribute('data-slot', 'results-view-invalid')
    expect(note).toHaveTextContent('2 saved View settings are invalid and ignored.')
    expect(variantOrder()).toEqual(['V0001', 'V0002'])
    expect(container.querySelectorAll('[data-row-filter]')).toHaveLength(1)
  })

  it('renders the no-match state when saved filters exclude every row', async () => {
    const experimentId = 'E0001-no-match'
    window.localStorage.setItem(
      `memon:results-table:research:${experimentId}:preferences`,
      JSON.stringify({
        rowFilters: [{ id: 'none', columnId: 'status', operator: 'eq', value: 'FAILED' }],
      }),
    )
    renderResults(experimentId)
    expect(await screen.findByText('No rows match the saved filters.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})

function renderResults(experimentId: string, summary: ResultsSummaryPayload = RESULTS) {
  return render(
    <ExperimentResultsTable
      summary={summary}
      project="research"
      experimentId={experimentId}
      runIds={[RUN_A, RUN_B, RUN_C]}
    />,
  )
}

function variantOrder(): string[] {
  return screen
    .getAllByRole('row')
    .map((row) => row.getAttribute('data-variant-id'))
    .filter((id): id is string => id !== null)
}

function headerIds(table: HTMLElement): string[] {
  return Array.from(table.querySelectorAll<HTMLElement>('thead [data-column-id]')).map(
    (header) => header.dataset.columnId ?? '',
  )
}

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  }
}
