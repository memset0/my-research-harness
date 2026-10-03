import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

const ANNOTATED_RESULTS: ResultsSummaryPayload = {
  ...RESULTS,
  columns: RESULTS.columns.map((entry) =>
    entry.key === 'params.lr'
      ? {
          ...entry,
          description: 'Controls the **optimizer step size**.',
          valueDescriptions: { '0.001': 'The **conservative** baseline.' },
        }
      : entry,
  ),
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

  afterEach(() => vi.unstubAllGlobals())

  it('uses summary column order, clamps to one line, scrolls horizontally, and renders br as breaks', async () => {
    const user = userEvent.setup()
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
    // The Variant name column is always pinned first and spans both header rows.
    expect(table.querySelector('thead [data-column-id="variant"]')).toHaveAttribute('rowspan', '2')
    expect(table).toHaveClass('table-auto', 'w-max', 'min-w-full')
    expect(table.parentElement).toHaveClass('overflow-x-auto')
    expect(container.querySelector('[data-max-lines="1"]')).toHaveStyle({
      maxHeight: 'calc(1 * 1.25rem)',
    })
    expect(screen.queryByText(/<br>/)).not.toBeInTheDocument()
    const notesCell = table.querySelector(
      '[data-variant-id="V0002"] [data-column-id="metrics.notes"]',
    )
    expect(notesCell?.querySelectorAll('br')).toHaveLength(1)

    // The vertical column tree replaces the horizontal checkbox strip.
    expect(
      container.querySelector('[data-slot="results-column-tree"] ul[aria-label="Results columns"]'),
    ).toBeInTheDocument()
    const lossOption = container.querySelector<HTMLElement>('[data-column-option="metrics.loss"]')!
    const learningRateOption = container.querySelector<HTMLElement>(
      '[data-column-option="params.lr"]',
    )!
    expect(lossOption).toHaveAttribute('data-column-group', 'metric')
    expect(lossOption).toHaveClass('bg-sky-50/60')
    expect(within(lossOption).queryByText('Metric')).not.toBeInTheDocument()
    expect(learningRateOption).toHaveAttribute('data-column-group', 'parameter')
    expect(learningRateOption).not.toHaveClass('bg-sky-50/60')

    const lossHeader = table.querySelector<HTMLElement>('thead [data-column-id="metrics.loss"]')!
    const lossCell = table.querySelector<HTMLElement>(
      '[data-variant-id="V0001"] [data-column-id="metrics.loss"]',
    )!
    expect(lossHeader).toHaveAttribute('data-column-group', 'metric')
    expect(lossHeader).toHaveClass('bg-sky-50/90')
    expect(lossHeader.querySelector('svg.lucide-chart-spline')).toBeInTheDocument()
    expect(lossCell).toHaveAttribute('data-column-group', 'metric')
    expect(lossCell).toHaveClass('bg-sky-50/40')

    expect(within(lossOption).getByText('2')).toBeInTheDocument()
    await user.hover(within(lossOption).getByText('Final loss'))
    expect(screen.queryByText('Final loss · 2 distinct values')).not.toBeInTheDocument()

    await user.hover(within(learningRateOption).getByText('Learning rate'))
    const domainHeading = await screen.findByText('Learning rate · 3 distinct values')
    const domainCard = domainHeading.closest<HTMLElement>('[data-slot="hover-card-content"]')!
    expect(within(domainCard).getByText('0.001')).toBeInTheDocument()
    expect(within(domainCard).getByText('0.002')).toBeInTheDocument()
    expect(within(domainCard).getByText('0.003')).toBeInTheDocument()
  })

  it('shows Markdown descriptions when annotated headers and values are hovered', async () => {
    const user = userEvent.setup()
    const { container } = renderResults('E0001-annotations', ANNOTATED_RESULTS)
    const headerButton = container.querySelector<HTMLElement>(
      '[data-column-id="params.lr"] button[data-has-description="true"]',
    )!
    expect(headerButton).toBeInTheDocument()

    await user.hover(headerButton)
    const columnTooltip = await screen.findByLabelText('Learning rate column description')
    expect(columnTooltip.querySelector('strong')).toHaveTextContent('optimizer step size')
    await user.unhover(headerButton)
    await waitFor(() => {
      expect(screen.queryByLabelText('Learning rate column description')).not.toBeInTheDocument()
    })

    const describedCell = container.querySelector<HTMLElement>(
      '[data-variant-id="V0001"] [data-column-id="params.lr"] [data-has-description="true"]',
    )!
    expect(describedCell).toHaveAttribute('tabindex', '0')
    await user.hover(describedCell)
    const valueTooltip = await screen.findByLabelText('Learning rate value description')
    expect(valueTooltip.querySelector('strong')).toHaveTextContent('conservative')

    const undescribedCell = container.querySelector<HTMLElement>(
      '[data-variant-id="V0002"] [data-column-id="params.lr"]',
    )!
    expect(undescribedCell.querySelector('[data-has-description]')).not.toBeInTheDocument()
  })

  it('checks a whole group, renders it indeterminate after one column is cleared, and inherits to later columns', async () => {
    const user = userEvent.setup()
    const { container } = renderResults('E0001-tree-checks', GROUPED_RESULTS)
    const table = screen.getByRole('table')
    const optimizer = screen.getByRole('checkbox', { name: 'Show Optimizer group' })
    expect(optimizer).toHaveAttribute('data-state', 'checked')

    await user.click(optimizer)
    expect(optimizer).toHaveAttribute('data-state', 'unchecked')
    for (const id of ['params.optim.lr', 'params.optim.batch_size', 'params.optim.adam.beta1'])
      expect(table.querySelector(`thead [data-column-id="${id}"]`)).not.toBeInTheDocument()

    await user.click(optimizer)
    expect(table.querySelector('thead [data-column-id="params.optim.lr"]')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Show Batch size column' }))
    expect(optimizer).toHaveAttribute('data-state', 'indeterminate')
    expect(container.querySelector('[data-tri-state="indeterminate"]')).toBeInTheDocument()
    expect(table.querySelector('thead [data-column-id="params.optim.lr"]')).toBeInTheDocument()
    expect(
      table.querySelector('thead [data-column-id="params.optim.batch_size"]'),
    ).not.toBeInTheDocument()

    // env is hidden by default; checking the partition shows its columns.
    expect(table.querySelector('thead [data-column-id="env.CUDA"]')).not.toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Show Environment partition' }))
    expect(table.querySelector('thead [data-column-id="env.CUDA"]')).toBeInTheDocument()

    await waitFor(() => {
      const preferences = storedPreferences('E0001-tree-checks')
      expect(preferences.nodeVisibility).toEqual({
        'group:params.optim': true,
        'params.optim.batch_size': false,
        'group:env': true,
      })
    })
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

  it('drags tree nodes within their parent only, moving groups as blocks', async () => {
    const { container } = renderResults('E0001-tree-drag', GROUPED_RESULTS)
    const table = screen.getByRole('table')
    const node = (id: string) => container.querySelector<HTMLElement>(`[data-tree-node="${id}"]`)!

    // C before A inside one group.
    dragBefore(node('params.optim.batch_size'), node('params.optim.lr'))
    expect(headerIds(table).slice(2, 5)).toEqual([
      'params.optim.batch_size',
      'params.optim.lr',
      'params.optim.adam.beta1',
    ])

    // A group moves as one block among its siblings; its columns stay adjacent.
    dragBefore(node('group:params.model'), node('group:params.optim'))
    expect(headerIds(table).slice(2, 6)).toEqual([
      'params.model.depth',
      'params.optim.batch_size',
      'params.optim.lr',
      'params.optim.adam.beta1',
    ])

    // A column cannot leave its group: the drop is refused, nothing changes.
    const before = headerIds(table)
    dragBefore(node('params.optim.lr'), node('params.model.depth'))
    expect(headerIds(table)).toEqual(before)

    // Header drag follows the same rule.
    dragBefore(
      table.querySelector<HTMLElement>('thead [data-column-id="params.optim.lr"]')!,
      table.querySelector<HTMLElement>('thead [data-column-id="params.optim.batch_size"]')!,
    )
    expect(headerIds(table).slice(3, 5)).toEqual(['params.optim.lr', 'params.optim.batch_size'])
    const refused = headerIds(table)
    dragBefore(
      table.querySelector<HTMLElement>('thead [data-column-id="params.seed"]')!,
      table.querySelector<HTMLElement>('thead [data-column-id="params.optim.lr"]')!,
    )
    expect(headerIds(table)).toEqual(refused)

    await waitFor(() => {
      expect(storedPreferences('E0001-tree-drag').treeOrder).toEqual({
        'group:params.optim': [
          'params.optim.lr',
          'params.optim.batch_size',
          'group:params.optim.adam',
        ],
        'group:params': ['group:params.model', 'group:params.optim', 'params.seed'],
      })
    })
  })

  it('composes checkbox changes batched before React renders', async () => {
    const first = renderResults('E0001-batched-checkboxes')
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    const loss = screen.getByRole('checkbox', { name: 'Show Final loss column' })
    const notes = screen.getByRole('checkbox', { name: 'Show Notes column' })

    act(() => {
      loss.click()
      notes.click()
    })

    expect(loss).toHaveAttribute('data-state', 'unchecked')
    expect(notes).toHaveAttribute('data-state', 'unchecked')
    await waitFor(() => {
      expect(storedPreferences('E0001-batched-checkboxes').nodeVisibility).toEqual({
        'metrics.loss': false,
        'metrics.notes': false,
      })
    })

    first.unmount()
    renderResults('E0001-batched-checkboxes')
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'Show Final loss column' })).toHaveAttribute(
        'data-state',
        'unchecked',
      ),
    )
    expect(screen.getByRole('checkbox', { name: 'Show Notes column' })).toHaveAttribute(
      'data-state',
      'unchecked',
    )
  })

  it('renders a pre-migration View on the migrated summary through the legacy alias', async () => {
    const user = userEvent.setup()
    const legacy = {
      hiddenColumnIds: ['schema:lr'],
      columnOrderIds: ['schema:notes', 'stale-column', 'schema:notes', 'variant'],
      defaultSortRules: [{ id: 's', columnId: 'schema:loss', direction: 'desc' }],
    }
    window.localStorage.setItem(
      'memon:results-table:research:E0001-legacy-view:preferences',
      JSON.stringify(legacy),
    )
    renderResults('E0001-legacy-view')
    const table = screen.getByRole('table')
    await waitFor(() =>
      expect(table.querySelector('thead [data-column-id="params.lr"]')).not.toBeInTheDocument(),
    )
    // Sorted by the aliased metric, descending (empty values last).
    expect(variantOrder()).toEqual(['V0002', 'V0001', 'V0003'])
    // The legacy order places Notes first among the metrics.
    expect(headerIds(table).filter((id) => id.startsWith('metrics.'))).toEqual([
      'metrics.notes',
      'metrics.loss',
    ])
    // The stored View keeps its legacy ids until the owner saves it.
    expect(storedCollection('E0001-legacy-view')[0]?.definition.hiddenColumnIds).toEqual([
      'schema:lr',
    ])
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Maximum lines per results cell' }), {
      target: { value: '2' },
    })
    await waitFor(() => {
      const saved = storedPreferences('E0001-legacy-view')
      expect(saved.hiddenColumnIds).toEqual([])
      expect(saved.nodeVisibility).toEqual({ 'params.lr': false })
      expect(saved.defaultSortRules).toEqual([
        { id: 's', columnId: 'metrics.loss', direction: 'desc' },
      ])
      expect(saved.maxLines).toBe(2)
    })
    await user.click(screen.getByRole('checkbox', { name: 'Show Learning rate column' }))
    expect(table.querySelector('thead [data-column-id="params.lr"]')).toBeInTheDocument()
  })

  it('renders wandb.ai values as compact chart links with the full URL on hover', async () => {
    const user = userEvent.setup()
    const { container } = renderResults('E0001-url-results', URL_RESULTS)

    const wandbLink = screen.getByRole('link', { name: 'Open W&B link a1b2c3d4e5f67890' })
    expect(wandbLink).toHaveAttribute('href', WANDB_URL)
    expect(wandbLink).toHaveAttribute('target', '_blank')
    expect(wandbLink).toHaveTextContent('a1b2c3d4e5f67890')
    expect(wandbLink).toHaveClass('text-primary', 'underline')
    expect(wandbLink.querySelector('svg')).toHaveClass('lucide-chart-spline')

    await user.hover(wandbLink)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(WANDB_URL)

    const ordinaryUrlCell = container.querySelector(
      '[data-variant-id="V0001"] [data-column-id="metrics.tracking"]',
    )
    expect(ordinaryUrlCell).toHaveTextContent(
      'https://github.com/example/research/actions/runs/1234',
    )
    expect(ordinaryUrlCell?.querySelector('a')).toBeNull()
  })

  it('keeps header sorting temporary while persisting visibility, line count, and stars', async () => {
    const user = userEvent.setup()
    const first = renderResults('E0001-results')

    await user.click(
      screen.getByRole('button', {
        name: 'Final loss: default sort; activate for temporary ascending',
      }),
    )
    expect(variantOrder()).toEqual(['V0001', 'V0002', 'V0003'])
    await user.click(
      screen.getByRole('button', {
        name: 'Final loss: temporarily sorted ascending; activate for descending',
      }),
    )
    expect(variantOrder()).toEqual(['V0002', 'V0001', 'V0003'])
    await user.click(
      screen.getByRole('button', {
        name: 'Final loss: temporarily sorted descending; activate for default sort',
      }),
    )
    expect(variantOrder()).toEqual(['V0001', 'V0002', 'V0003'])

    fireEvent.contextMenu(screen.getByRole('columnheader', { name: /Notes/ }))
    expect(await screen.findByRole('menuitem', { name: 'Star column' })).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'Hide column' }))
    expect(screen.queryByRole('columnheader', { name: /Notes/ })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Show Notes column' })).toHaveAttribute(
      'data-state',
      'unchecked',
    )
    await user.click(screen.getByRole('button', { name: 'Show all columns temporarily' }))
    expect(screen.getByRole('columnheader', { name: /Notes/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Resume saved column filters' }))
    expect(screen.queryByRole('columnheader', { name: /Notes/ })).not.toBeInTheDocument()

    const maxLines = screen.getByRole('spinbutton', { name: 'Maximum lines per results cell' })
    fireEvent.change(maxLines, { target: { value: '3' } })
    expect(first.container.querySelector('[data-max-lines="3"]')).toHaveStyle({
      maxHeight: 'calc(3 * 1.25rem)',
    })

    fireEvent.contextMenu(screen.getByRole('columnheader', { name: /Final loss/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'Star column' }))
    expect(screen.getByRole('columnheader', { name: /Final loss/ })).toHaveClass('bg-amber-50')

    await waitFor(() => {
      const preferences = storedPreferences('E0001-results')
      expect(preferences.nodeVisibility).toEqual({ 'metrics.notes': false })
      expect(preferences.maxLines).toBe(3)
      expect(preferences.defaultSortRules).toEqual([])
      expect(
        JSON.parse(
          window.localStorage.getItem('memon:results-table:research:starred-column-labels') ?? '[]',
        ),
      ).toContain('Final loss')
    })

    first.unmount()
    const restored = renderResults('E0001-results')
    await waitFor(() =>
      expect(
        screen.getByRole('spinbutton', { name: 'Maximum lines per results cell' }),
      ).toHaveValue(3),
    )
    expect(screen.queryByRole('columnheader', { name: /Notes/ })).not.toBeInTheDocument()
    restored.unmount()

    renderResults('E0002-other-experiment')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Unstar Final loss column' })).toBeInTheDocument(),
    )
    expect(screen.getByRole('columnheader', { name: /Final loss/ })).toHaveClass('bg-amber-50')
  })

  it('requires explicit confirmation before resetting saved and temporary view state', async () => {
    const user = userEvent.setup()
    renderResults('E0001-reset-confirmation')

    await user.click(screen.getByRole('checkbox', { name: 'Show Notes column' }))
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Maximum lines per results cell' }), {
      target: { value: '3' },
    })
    await addDefaultSort(user, 'Final loss', 'Large to small (descending)')
    await user.click(
      screen.getByRole('button', {
        name: 'Learning rate: default sort; activate for temporary ascending',
      }),
    )
    await waitFor(() => {
      const preferences = storedPreferences('E0001-reset-confirmation')
      expect(preferences.defaultSortRules).toHaveLength(1)
      expect(preferences.nodeVisibility).toEqual({ 'metrics.notes': false })
      expect(preferences.maxLines).toBe(3)
    })
    const resetButton = screen.getByRole('button', { name: 'Reset view' })
    await user.click(resetButton)
    const dialog = await screen.findByRole('dialog', { name: 'Reset Results view?' })
    expect(dialog).toHaveTextContent('saved default sort')
    expect(dialog).toHaveTextContent('This cannot be undone')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus())
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('checkbox', { name: 'Show Notes column' })).toHaveAttribute(
      'data-state',
      'unchecked',
    )

    await user.click(resetButton)
    await user.click(screen.getByRole('button', { name: 'Confirm reset Results view' }))
    expect(screen.getByRole('checkbox', { name: 'Show Notes column' })).toHaveAttribute(
      'data-state',
      'checked',
    )
    expect(screen.getByRole('spinbutton', { name: 'Maximum lines per results cell' })).toHaveValue(
      1,
    )
    expect(screen.queryByText('Temporary · Learning rate ↑')).not.toBeInTheDocument()
    expect(resetButton).toBeDisabled()
    await waitFor(() =>
      expect(storedPreferences('E0001-reset-confirmation')).toEqual({
        hiddenColumnIds: [],
        columnOrderIds: [],
        maxLines: 1,
        defaultSortRules: [],
        pinnedColumnIds: { left: [], right: [] },
        rowFilters: [],
        rowOverrides: {},
        sotaModes: {},
        decimalPlaces: {},
        nodeVisibility: {},
        treeOrder: {},
        collapsedGroups: [],
        statsDisplay: {},
        statsSort: {},
      }),
    )
  })

  it('persists an ordered default sort chain and keeps header sort temporary', async () => {
    const user = userEvent.setup()
    const first = renderResults('E0001-default-sort')

    expect(variantOrder()).toEqual(['V0001', 'V0002', 'V0003'])
    await addDefaultSort(user, 'Notes', 'Large to small (descending)')
    expect(variantOrder()).toEqual(['V0001', 'V0003', 'V0002'])
    await addDefaultSort(user, 'Learning rate', 'Large to small (descending)')
    expect(variantOrder()).toEqual(['V0003', 'V0001', 'V0002'])

    const sortRules = first.container.querySelectorAll<HTMLElement>('[data-sort-rule-order]')
    dragBefore(sortRules[1]!, sortRules[0]!)
    expect(
      screen.getByRole('button', { name: 'Edit sort 1 Learning rate descending' }),
    ).toBeInTheDocument()
    expect(variantOrder()).toEqual(['V0003', 'V0002', 'V0001'])

    await waitFor(() => {
      expect(storedPreferences('E0001-default-sort').defaultSortRules).toMatchObject([
        { columnId: 'params.lr', direction: 'desc' },
        { columnId: 'metrics.notes', direction: 'desc' },
      ])
    })
  })

  it('persists AND row filters and force overrides while show-all remains temporary', async () => {
    const user = userEvent.setup()
    const first = renderResults('E0001-row-filters')

    await addRowFilter(user, 'Final loss', 'Greater than (>)', '0.15')
    expect(variantOrder()).toEqual(['V0002'])
    await addRowFilter(user, 'Status', 'Equals (=)', 'COMPLETED')
    expect(variantOrder()).toEqual(['V0002'])
    expect(first.container.querySelectorAll('[data-row-filter]')).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: 'Show all rows temporarily' }))
    fireEvent.contextMenu(first.container.querySelector('[data-variant-id="V0001"]')!)
    await user.click(await screen.findByRole('menuitem', { name: 'Force show row' }))
    await user.click(screen.getByRole('button', { name: 'Resume saved row filters' }))
    expect(variantOrder()).toEqual(['V0001', 'V0002'])

    fireEvent.contextMenu(first.container.querySelector('[data-variant-id="V0002"]')!)
    await user.click(await screen.findByRole('menuitem', { name: 'Force hide row' }))
    expect(variantOrder()).toEqual(['V0001'])
    await waitFor(() =>
      expect(storedPreferences('E0001-row-filters').rowOverrides).toEqual({
        V0001: 'include',
        V0002: 'exclude',
      }),
    )
  })

  it('pins single columns into the left zone after the Variant column with a breadcrumb', async () => {
    const user = userEvent.setup()
    const { container } = renderResults('E0001-pins', GROUPED_RESULTS)
    const table = screen.getByRole('table')
    let viewportWidth = 500
    Object.defineProperty(table.parentElement, 'clientWidth', {
      configurable: true,
      get: () => viewportWidth,
    })
    const mockWidths = () => {
      for (const header of Array.from(table.querySelectorAll<HTMLElement>('thead th'))) {
        Object.defineProperty(header, 'getBoundingClientRect', {
          configurable: true,
          value: () => ({
            bottom: 32,
            height: 32,
            left: 0,
            right: 120,
            top: 0,
            width: 120,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          }),
        })
      }
    }

    await user.click(screen.getByRole('button', { name: 'Pin LR column' }))
    mockWidths()
    await chooseHeaderAction(user, 'FID', 'Pin column')
    mockWidths()
    fireEvent(window, new Event('resize'))

    expect(pinnedHeaderIds(table)).toEqual(['variant', 'params.optim.lr', 'metrics.eval.fid'])
    expect(
      table.querySelector('thead [data-column-id="params.optim.lr"] [data-column-label]'),
    ).toHaveTextContent('Optimizer › LR')
    // Batch size stays in its group; the tree marks and lists the pins.
    expect(table.querySelector('thead [data-group-id="group:params.optim"]')).toHaveAttribute(
      'colspan',
      '2',
    )
    expect(
      container.querySelector('[data-column-option="params.optim.lr"] [data-pin-indicator]'),
    ).toBeInTheDocument()
    const pinnedSection = container.querySelector<HTMLElement>(
      '[data-slot="results-column-tree-pinned"]',
    )!
    expect(
      Array.from(pinnedSection.querySelectorAll<HTMLElement>('[data-pinned-option]')).map(
        (row) => row.dataset.pinnedOption,
      ),
    ).toEqual(['params.optim.lr', 'metrics.eval.fid'])

    await waitFor(() => {
      expect(screen.getByRole('columnheader', { name: /Optimizer › LR/ })).toHaveClass('sticky')
      expect(screen.getByRole('columnheader', { name: /FID/ })).toHaveStyle({ left: '240px' })
      expect(screen.getByRole('columnheader', { name: /FID/ })).toHaveClass('!bg-sky-50')
      expect(
        table.querySelector('[data-variant-id="V0001"] [data-column-id="metrics.eval.fid"]'),
      ).toHaveClass('!bg-sky-50', 'dark:!bg-sky-950')
    })

    // Reorder pins in the tree's pinned section.
    const pinRows = pinnedSection.querySelectorAll<HTMLElement>('[data-pinned-option]')
    dragBefore(pinRows[1]!, pinRows[0]!)
    expect(pinnedHeaderIds(table)).toEqual(['variant', 'metrics.eval.fid', 'params.optim.lr'])

    // Oversized pins degrade to ordered scrolling.
    viewportWidth = 300
    mockWidths()
    fireEvent(window, new Event('resize'))
    await waitFor(() =>
      expect(screen.getByRole('columnheader', { name: /Optimizer › LR/ })).not.toHaveClass(
        'sticky',
      ),
    )

    // Unpinning returns LR before Batch size inside its group.
    await user.click(within(pinnedSection).getByRole('button', { name: 'Unpin Optimizer › LR' }))
    expect(headerIds(table).filter((id) => id.startsWith('params.optim'))).toEqual([
      'params.optim.lr',
      'params.optim.batch_size',
      'params.optim.adam.beta1',
    ])
    await waitFor(() =>
      expect(storedPreferences('E0001-pins').pinnedColumnIds).toEqual({
        left: ['metrics.eval.fid'],
        right: [],
      }),
    )
  })

  it('collapses a group to a placeholder independently of hidden columns', async () => {
    const user = userEvent.setup()
    renderResults('E0001-collapse', GROUPED_RESULTS)
    const table = screen.getByRole('table')
    await user.click(screen.getByRole('checkbox', { name: 'Show Batch size column' }))
    await user.click(screen.getByRole('button', { name: 'Collapse Optimizer group' }))
    const placeholder = table.querySelector('thead [data-collapsed-group="group:params.optim"]')
    expect(placeholder).toHaveTextContent('2 cols')
    expect(table.querySelector('thead [data-column-id="params.optim.lr"]')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Expand Optimizer group' }))
    expect(headerIds(table).filter((id) => id.startsWith('params.optim'))).toEqual([
      'params.optim.lr',
      'params.optim.adam.beta1',
    ])
    await waitFor(() => expect(storedPreferences('E0001-collapse').collapsedGroups).toEqual([]))
  })

  it('renders stats as one column with a display dropdown saved in the View', async () => {
    const user = userEvent.setup()
    const { container } = renderResults('E0001-stats', GROUPED_RESULTS)
    const table = screen.getByRole('table')
    const fid = () =>
      table.querySelector<HTMLElement>(
        '[data-variant-id="V0001"] [data-column-id="metrics.eval.fid"]',
      )!
    const clip = () =>
      table.querySelector<HTMLElement>(
        '[data-variant-id="V0001"] [data-column-id="metrics.eval.clip"]',
      )!
    // Seeds aggregate by default; a one-Run stats cell reads mean ± std.
    expect(fid()).toHaveTextContent('11 ± 1 (3)')
    expect(clip()).toHaveTextContent('0.312 ± 0.021')
    const before = headerIds(table).length

    await user.click(screen.getByRole('button', { name: /^Display of CLIP/ }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitemradio', { name: 'p50/p99' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitemradio', { name: 'mean±sem' })).not.toBeInTheDocument()
    expect(within(menu).queryByRole('menuitemradio', { name: 'median' })).not.toBeInTheDocument()
    await user.click(within(menu).getByRole('menuitemradio', { name: 'p50/p99' }))
    expect(clip()).toHaveTextContent('0.310/0.400')
    expect(headerIds(table)).toHaveLength(before)
    await waitFor(() =>
      expect(storedPreferences('E0001-stats').statsDisplay).toEqual({
        'metrics.eval.clip': 'p50/p99',
      }),
    )
    // The display also decides the sort statistic: by p50 V0002 ranks above
    // V0001 descending (by mean it would not).
    await user.click(
      screen.getByRole('button', { name: 'CLIP: default sort; activate for temporary ascending' }),
    )
    await user.click(
      screen.getByRole('button', {
        name: 'CLIP: temporarily sorted ascending; activate for descending',
      }),
    )
    expect(variantOrder().slice(0, 2)).toEqual(['V0002', 'V0001'])

    // Hovering a stats cell lists every statistic and its contributing Runs.
    await user.hover(within(fid()).getByText('11 ± 1 (3)'))
    const details = await screen.findByLabelText('FID statistics')
    expect(details).toHaveTextContent('Across 3 evidence Runs')
    expect(details).toHaveTextContent('p99')
    expect(details).toHaveTextContent('logs/c-261001-000000')

    // Markers: mixed, frozen, differs from plan, planned and BLOCKED.
    expect(
      table.querySelector(
        '[data-variant-id="V0001"] [data-column-id="params.seed"] [data-cell-marker="mixed"]',
      ),
    ).toBeInTheDocument()
    expect(
      table.querySelector(
        '[data-variant-id="V0003"] [data-column-id="metrics.eval.fid"] [data-cell-marker="frozen"]',
      ),
    ).toBeInTheDocument()
    const drifted = table.querySelector(
      '[data-variant-id="V0002"] [data-column-id="params.optim.lr"] [data-cell-marker="differs-from-plan"]',
    )
    expect(drifted).toHaveAttribute('title', 'Differs from the planned value 0.0001')
    expect(
      table.querySelector(
        '[data-variant-id="V0004"] [data-column-id="params.optim.lr"] [data-cell-source="planned"]',
      ),
    ).toBeInTheDocument()
    expect(
      table.querySelector(
        '[data-variant-id="V0004"] [data-column-id="status"] [data-status="BLOCKED"]',
      ),
    ).toBeInTheDocument()
    expect(container.querySelector('[data-slot="results-table"]')).toBeInTheDocument()
  })

  it('persists SOTA mode and decimal places per metric column', async () => {
    cleanup()
    const user = userEvent.setup()
    const { container, unmount } = renderResults('E0001-sota-a')
    const lossHeader = container.querySelector<HTMLElement>(
      '[data-column-id="metrics.loss"] button',
    )!
    fireEvent.contextMenu(lossHeader)
    const body = window.document.body
    const sotaTrigger = Array.from(
      body.querySelectorAll<HTMLElement>('[data-slot="context-menu-sub-trigger"]'),
    ).find((el) => el.textContent?.includes('SOTA highlight'))!
    await act(async () => {
      fireEvent.click(sotaTrigger)
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /Higher is better/i }))
    })
    fireEvent.contextMenu(lossHeader)
    const decimalTrigger = Array.from(
      body.querySelectorAll<HTMLElement>('[data-slot="context-menu-sub-trigger"]'),
    ).find((el) => el.textContent?.includes('Decimal places'))!
    await act(async () => {
      fireEvent.click(decimalTrigger)
    })
    const plusButton = screen.getByRole('button', { name: /Increase decimal places/i })
    await user.click(plusButton)
    await user.click(plusButton)

    const table = container.querySelector('table')!
    const lossText = (id: string) =>
      table.querySelector(
        `[data-variant-id="${id}"] [data-column-id="metrics.loss"] [data-cell-kind] > span`,
      )
    await waitFor(() => expect(lossText('V0002')).toHaveClass('font-bold', 'underline'))
    expect(lossText('V0001')).toHaveClass('font-bold')
    expect(lossText('V0001')).not.toHaveClass('underline')
    expect(lossText('V0001')).toHaveTextContent('0.10')
    expect(lossText('V0002')).toHaveTextContent('0.20')
    const lrText = table.querySelector(
      '[data-variant-id="V0001"] [data-column-id="params.lr"] [data-cell-kind] > span',
    )
    expect(lrText).not.toHaveClass('font-bold', 'underline')
    expect(lrText).toHaveTextContent('0.001')

    unmount()
    await waitFor(() => {
      const preferences = storedPreferences('E0001-sota-a')
      expect(preferences.sotaModes).toEqual({ 'metrics.loss': 'higher-is-better' })
      expect(preferences.decimalPlaces).toEqual({ 'metrics.loss': 2 })
    })
  })

  it('ranks a declared lower-is-better column without choosing a direction', async () => {
    cleanup()
    const { container } = renderResults('E0001-sota-declared', GROUPED_RESULTS)
    const fidHeader = container.querySelector<HTMLElement>(
      '[data-column-id="metrics.eval.fid"] button',
    )!
    fireEvent.contextMenu(fidHeader)
    const sotaTrigger = Array.from(
      window.document.body.querySelectorAll<HTMLElement>('[data-slot="context-menu-sub-trigger"]'),
    ).find((el) => el.textContent?.includes('SOTA highlight'))!
    await act(async () => {
      fireEvent.click(sotaTrigger)
    })
    expect(screen.queryByRole('menuitem', { name: /^Higher is better$/ })).not.toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /Lower is better \(declared\)/ }))
    })
    const table = container.querySelector('table')!
    const fidText = (id: string) =>
      table.querySelector(
        `[data-variant-id="${id}"] [data-column-id="metrics.eval.fid"] [data-cell-kind] > span`,
      )
    await waitFor(() => expect(fidText('V0002')).toHaveClass('font-bold', 'underline'))
    expect(fidText('V0001')).toHaveClass('font-bold')
  })

  it('surfaces malformed saved View settings instead of dropping them silently', async () => {
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
    // The malformed filter is ignored; the id-less valid filter still applies.
    expect(variantOrder()).toEqual(['V0001', 'V0002'])
    expect(container.querySelectorAll('[data-row-filter]')).toHaveLength(1)
  })
})

function renderResults(experimentId: string, summary: ResultsSummaryPayload = RESULTS) {
  const portalRoot = window.document.createElement('div')
  portalRoot.id = 'portal-root'
  window.document.body.appendChild(portalRoot)
  const result = render(
    <ExperimentResultsTable
      summary={summary}
      project="research"
      experimentId={experimentId}
      runIds={[RUN_A, RUN_B, RUN_C]}
    />,
  )
  return {
    ...result,
    portalRoot,
    unmount: () => {
      result.unmount()
      portalRoot.remove()
    },
  }
}

function storedPreferences(experimentId: string): Record<string, unknown> & {
  nodeVisibility?: Record<string, boolean>
  treeOrder?: Record<string, string[]>
  [key: string]: unknown
} {
  return JSON.parse(
    window.localStorage.getItem(`memon:results-table:research:${experimentId}:preferences`) ?? '{}',
  )
}

function storedCollection(
  experimentId: string,
): Array<{ definition: { hiddenColumnIds: string[] } }> {
  return JSON.parse(
    window.localStorage.getItem(`memon:results-views:research:${experimentId}:collection`) ?? '[]',
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

function pinnedHeaderIds(table: HTMLElement): string[] {
  return Array.from(table.querySelectorAll<HTMLElement>('thead [data-column-id][data-pinned]')).map(
    (header) => header.dataset.columnId ?? '',
  )
}

function dragBefore(source: HTMLElement, target: HTMLElement) {
  const dataTransfer = { dropEffect: 'none', effectAllowed: 'none', setData: vi.fn() }
  fireEvent.dragStart(source, { dataTransfer })
  fireEvent.dragOver(target, { clientX: 0, clientY: 0, dataTransfer })
  fireEvent.drop(target, { clientX: 0, clientY: 0, dataTransfer })
  fireEvent.dragEnd(source, { dataTransfer })
}

async function chooseHeaderAction(
  user: ReturnType<typeof userEvent.setup>,
  columnName: string,
  actionName: string,
) {
  fireEvent.contextMenu(screen.getByRole('columnheader', { name: new RegExp(columnName) }))
  await user.click(await screen.findByRole('menuitem', { name: actionName }))
}

async function chooseSelectOption(
  user: ReturnType<typeof userEvent.setup>,
  selectName: string,
  optionName: string,
) {
  await user.click(screen.getByRole('combobox', { name: selectName }))
  await user.click(await screen.findByRole('option', { name: optionName }))
}

async function addRowFilter(
  user: ReturnType<typeof userEvent.setup>,
  columnName: string,
  operatorName: string,
  value: string,
) {
  await user.click(screen.getByRole('button', { name: 'Add row filter' }))
  await chooseSelectOption(user, 'Filter column', columnName)
  await chooseSelectOption(user, 'Filter operator', operatorName)
  await user.type(screen.getByLabelText('Filter value'), value)
  await user.click(screen.getByRole('button', { name: 'Add filter' }))
}

async function addDefaultSort(
  user: ReturnType<typeof userEvent.setup>,
  columnName: string,
  directionName: string,
) {
  await user.click(screen.getByRole('button', { name: 'Add default sort' }))
  await chooseSelectOption(user, 'Sort column', columnName)
  await chooseSelectOption(user, 'Sort direction', directionName)
  await user.click(screen.getByRole('button', { name: 'Add sort' }))
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
