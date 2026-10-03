import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { buildColumns } from '../../lib/experiment-results/columns'
import {
  resultsDocument,
  column as summaryColumn,
  variant,
} from '../../lib/experiment-results/fixtures.test-helpers'
import { buildColumnTree, layoutGrid, nodeCheckState } from '../../lib/experiment-results/tree'
import type { ResultTableColumn } from '../../lib/experiment-results/types'
import { RunResultTree } from '../run-result-tree'
import { ResultCell, StatusCell } from './cells'
import type { ColumnHeaderActions } from './column-header'
import { ColumnToolbar } from './column-toolbar'
import { ColumnTreeControls } from './column-tree'
import { FilterBar } from './filter-bar'
import { ResultsErrorCard } from './results-error-card'
import { ResultsGrid } from './results-grid'
import type { DragHandlers } from './use-drag-reorder'
import { type ViewCollection, ViewSwitcher } from './view-switcher'

const SUMMARY = resultsDocument(
  [
    variant('V0001', {
      name: 'Baseline',
      parameters: { lr: 0.001 },
      metrics: { loss: 0.123456 },
      evidence: ['logs/run-a-261001-000000', 'logs/run-x-261001-000000'],
    }),
    variant('V0002', {
      name: 'Faster',
      status: 'FAILED',
      parameters: { lr: 0.01 },
      metrics: { loss: null },
    }),
  ],
  [summaryColumn('params.lr', 'Learning rate'), summaryColumn('metrics.loss', 'Final loss')],
)

const COLUMNS = buildColumns(SUMMARY, { decimalPlaces: { 'metrics.loss': 2 } })
const TREE = buildColumnTree(COLUMNS, SUMMARY.groups)
const column = (id: string) => COLUMNS.find((candidate) => candidate.id === id) as ResultTableColumn

const NO_DRAG: DragHandlers = {
  bind: () => ({
    draggable: true,
    onDragStart: () => undefined,
    onDragOver: () => undefined,
    onDrop: () => undefined,
    onDragEnd: () => undefined,
  }),
  isDragged: () => false,
  isDropTarget: () => false,
}

const NO_ACTIONS: ColumnHeaderActions = {
  onCycleSort: vi.fn(),
  onHide: vi.fn(),
  onSetPinned: vi.fn(),
  onToggleStar: vi.fn(),
  onSetSotaMode: vi.fn(),
  onSetDecimalPlaces: vi.fn(),
  onSetStatsDisplay: vi.fn(),
  onSetStatsSort: vi.fn(),
}

describe('ResultsGrid', () => {
  it('renders the shadcn table with a two-row header and formatted cells', () => {
    const layout = layoutGrid(TREE, column('variant'), {
      visible: (id) => ['params.lr', 'metrics.loss', 'runs'].includes(id),
      pinned: [],
      collapsed: new Set(),
    })
    const { container } = render(
      <ResultsGrid
        layout={layout}
        variants={SUMMARY.variants}
        context={{
          project: 'project-a',
          experimentId: 'E0001-demo',
          declaredRunIds: new Set(['logs/run-a-261001-000000']),
          maxLines: 2,
          starredLabels: new Set(['Final loss']),
          sotaRanks: new Map([['metrics.loss', { ranks: new Map([['V0001', 1]]), active: true }]]),
          decimalPlaces: { 'metrics.loss': 2 },
        }}
        rowOverrides={{ V0002: 'exclude' }}
        temporarySort={{ columnId: 'params.lr', direction: 'desc' }}
        sotaModes={{ 'metrics.loss': 'lower-is-better' }}
        statsDisplay={{}}
        statsSort={{}}
        canMutate
        drag={NO_DRAG}
        headerActions={NO_ACTIONS}
        onToggleCollapsed={vi.fn()}
        onSetRowOverride={vi.fn()}
      />,
    )
    const table = container.querySelector('[data-slot="table"]') as HTMLElement
    expect(table).toHaveAttribute('data-results-table-grid')
    const headers = Array.from(table.querySelectorAll<HTMLElement>('thead [data-column-id]'))
    expect(headers.map((header) => header.dataset.columnId)).toEqual([
      'variant',
      'params.lr',
      'metrics.loss',
      'runs',
    ])
    expect(headers[0]).toHaveAttribute('data-pinned', 'left')
    expect(headers[0]).toHaveAttribute('rowspan', '2')
    expect(headers[1]).toHaveAttribute('aria-sort', 'descending')
    expect(headers[2]).toHaveAttribute('data-column-group', 'metric')
    expect(table.querySelector('thead [data-group-id="group:$provenance"]')).toHaveTextContent(
      'Provenance',
    )

    const loss = table.querySelector('[data-variant-id="V0001"] [data-column-id="metrics.loss"]')
    expect(loss).toHaveTextContent('0.12')
    expect(loss?.querySelector('[data-cell-kind] > span')).toHaveClass('font-bold', 'underline')
    expect(loss?.querySelector('[data-max-lines="2"]')).not.toBeNull()
    expect(table.querySelector('[data-variant-id="V0002"]')).toHaveAttribute(
      'data-row-override',
      'exclude',
    )
    expect(within(table).getByRole('link', { name: 'logs/run-a-261001-000000' })).toHaveAttribute(
      'href',
      '/p/project-a/e/E0001-demo?run=logs%2Frun-a-261001-000000',
    )
    expect(within(table).queryByRole('link', { name: 'logs/run-x-261001-000000' })).toBeNull()
  })
})

describe('cells', () => {
  it('renders status badges and empty values', () => {
    const { container } = render(
      <>
        <StatusCell variant={{ status: 'RUNNING', declaredStatus: null }} />
        <ResultCell
          column={column('metrics.loss')}
          variant={SUMMARY.variants[1]!}
          project="project-a"
          experimentId="E0001-demo"
          declaredRunIds={new Set()}
        />
      </>,
    )
    expect(container.querySelector('[data-slot="badge"]')).toHaveTextContent('RUNNING')
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('renders a BLOCKED Variant through the status badge and flags a stale declaration', () => {
    const { container } = render(
      <>
        <ResultCell
          column={column('status')}
          variant={{ ...SUMMARY.variants[0]!, status: 'BLOCKED', declaredStatus: 'BLOCKED' }}
          project="project-a"
          experimentId="E0001-demo"
          declaredRunIds={new Set()}
        />
        <StatusCell variant={{ status: 'RUNNING', declaredStatus: 'BLOCKED' }} />
      </>,
    )
    const badge = container.querySelector('[data-slot="badge"]')
    expect(badge).toHaveTextContent('BLOCKED')
    expect(badge).toHaveAttribute('data-status', 'BLOCKED')
    expect(badge).toHaveClass('border-dashed', 'border-orange-400', 'bg-orange-50')
    expect(container.querySelector('[data-status-stale]')).toHaveTextContent('declared BLOCKED')
  })

  it('lists other Runs with their status and deprecation', () => {
    const row = variant('V1', {
      others: [
        { run: 'logs/f-261001-000000', status: 'FAILED', deprecated: false, stopReason: 'oom' },
        { run: 'logs/d-261001-000000', status: 'FINISHED', deprecated: true, stopReason: null },
      ],
    })
    const { container } = render(
      <ResultCell
        column={column('attempts')}
        variant={row}
        project="project-a"
        experimentId="E0001-demo"
        declaredRunIds={new Set(['logs/f-261001-000000'])}
      />,
    )
    expect(container).toHaveTextContent('FAILED')
    expect(container).toHaveTextContent('(deprecated)')
    expect(container.querySelector('[title="stop reason: oom"]')).toBeInTheDocument()
  })
})

describe('ColumnTreeControls', () => {
  it('renders a vertical tree with tri-state checks, counts, pin indicators and stars', () => {
    const { container } = render(
      <ColumnTreeControls
        experimentId="E0001-demo"
        locked={false}
        tree={TREE}
        checkState={(node) =>
          nodeCheckState(node, (id) => id !== 'status' && id !== 'metrics.loss')
        }
        domains={new Map([['params.lr', ['0.001', '0.01']]])}
        starredLabels={new Set(['Learning rate'])}
        pinned={[{ id: 'params.lr', label: 'Learning rate' }]}
        drag={NO_DRAG}
        onSetVisible={vi.fn()}
        onSetPinned={vi.fn()}
        onToggleStar={vi.fn()}
      />,
    )
    expect(container.querySelector('[data-slot="results-column-tree-nodes"]')).toBeInTheDocument()
    expect(container.querySelectorAll('[data-column-option]')).toHaveLength(TREE.leafOrder.length)
    expect(screen.getByRole('checkbox', { name: 'Show Status column' })).toHaveAttribute(
      'data-state',
      'unchecked',
    )
    expect(screen.getByRole('checkbox', { name: 'Show Metrics partition' })).toHaveAttribute(
      'data-state',
      'unchecked',
    )
    expect(screen.getByRole('button', { name: 'Unstar Learning rate column' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(
      container.querySelector('[data-column-option="params.lr"] [data-pin-indicator]'),
    ).toBeInTheDocument()
    expect(container.querySelector('[data-slot="results-column-tree-pinned"]')).toHaveTextContent(
      'Learning rate',
    )
    expect(container.querySelector('[data-column-option="metrics.loss"]')).toHaveAttribute(
      'data-column-group',
      'metric',
    )
  })

  it('folds and unfolds tree nodes without changing visibility', async () => {
    const user = userEvent.setup()
    const onSetVisible = vi.fn()
    render(
      <ColumnTreeControls
        experimentId="E0001-demo"
        locked={false}
        tree={TREE}
        checkState={() => true}
        domains={new Map()}
        starredLabels={new Set()}
        pinned={[]}
        drag={NO_DRAG}
        onSetVisible={onSetVisible}
        onSetPinned={vi.fn()}
        onToggleStar={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Collapse Parameters in the column tree' }))
    expect(screen.queryByRole('checkbox', { name: 'Show Learning rate column' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Expand Parameters in the column tree' }))
    expect(screen.getByRole('checkbox', { name: 'Show Learning rate column' })).toBeInTheDocument()
    expect(onSetVisible).not.toHaveBeenCalled()
  })
})

describe('ResultsErrorCard', () => {
  it('shows the code, every offending file and a copyable upgrade command, never a row', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const { container } = render(
      <ResultsErrorCard
        error={{
          code: 'RESULT_SCHEMA_MISMATCH',
          message: '1 member result file records another or no experiment_schema_version',
          files: [{ file: 'logs/b-260901-100000/result.csv', version: 1 }],
          upgradeCommand: 'memon experiment schema upgrade E0001-foo --to 2',
          expectedVersion: 2,
        }}
      />,
    )
    const card = container.querySelector('[data-slot="results-error"]')!
    expect(card).toHaveAttribute('data-error-code', 'RESULT_SCHEMA_MISMATCH')
    expect(card).toHaveTextContent('logs/b-260901-100000/result.csv')
    expect(card).toHaveTextContent('records version 1')
    expect(card.querySelector('[data-slot="results-upgrade-command"]')).toHaveTextContent(
      'memon experiment schema upgrade E0001-foo --to 2',
    )
    expect(container.querySelector('table')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Copy the upgrade command' }))
    expect(writeText).toHaveBeenCalledWith('memon experiment schema upgrade E0001-foo --to 2')
  })

  it('names duplicate rows with their lines', () => {
    const { container } = render(
      <ResultsErrorCard
        error={{
          code: 'RESULT_DUPLICATE_ROW',
          message: 'duplicate',
          files: [
            {
              file: 'logs/a-260901-090000/result.csv',
              duplicates: [{ key: 'metrics.eval.fid', stat: null, lines: [3, 7] }],
            },
          ],
        }}
      />,
    )
    expect(container).toHaveTextContent('duplicate metrics.eval.fid on lines 3, 7')
    expect(container.querySelector('[data-slot="results-upgrade-command"]')).toBeNull()
  })
})

describe('RunResultTree', () => {
  it('renders result.csv rows as a collapsible tree of path groups', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <RunResultTree
        result={{
          resource: 'logs/a-260901-090000/result.csv',
          schemaVersion: 2,
          truncated: false,
          diagnostics: [],
          rows: [
            { key: 'params.optim.lr', stat: null, value: '0.0001', line: 3 },
            { key: 'metrics.eval.clip', stat: 'std', value: '0.02', line: 4 },
            { key: 'metrics.eval.clip', stat: 'mean', value: '0.31', line: 5 },
            { key: 'metrics.notes', stat: null, value: '', line: 6 },
          ],
        }}
      />,
    )
    expect(container.querySelector('[data-result-schema-version]')).toHaveTextContent('schema v2')
    expect(container.querySelector('[data-result-group="params.optim"]')).toBeInTheDocument()
    const clip = container.querySelector<HTMLElement>('[data-result-path="metrics.eval.clip"]')!
    expect(
      within(clip)
        .getAllByRole('rowheader')
        .map((cell) => cell.textContent),
    ).toEqual(['mean', 'std'])
    expect(container.querySelector('[data-result-path="metrics.notes"]')).toHaveTextContent('—')
    await user.click(screen.getByRole('button', { name: /Metrics/ }))
    expect(container.querySelector('[data-result-path="metrics.eval.clip"]')).toBeNull()
    expect(container.querySelector('[data-result-path="params.optim.lr"]')).toBeInTheDocument()
  })
})

describe('ViewSwitcher', () => {
  const views = (overrides: Partial<ViewCollection> = {}): ViewCollection => ({
    views: [],
    activeView: null,
    canMutate: false,
    loading: false,
    error: null,
    selectView: vi.fn(),
    createView: vi.fn(),
    renameView: vi.fn(),
    deleteView: vi.fn(),
    ...overrides,
  })

  it('is read-only for viewers', () => {
    const { container } = render(
      <ViewSwitcher experimentId="E0001-demo" views={views()} onActiveViewReplaced={vi.fn()} />,
    )
    expect(container.querySelector('[data-slot="results-view-controls"]')).not.toBeNull()
    expect(screen.getByText('Read-only')).toBeInTheDocument()
    expect(screen.getByText('0 views')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete Results view' })).toBeNull()
  })

  it('offers lifecycle actions to owners', () => {
    const view = {
      id: 'v1',
      scope: { host: null, project: 'project-a', experimentId: 'E0001-demo' },
      name: 'Default',
      definition: {} as never,
      revision: 1,
      createdAt: 0,
      updatedAt: 0,
    }
    render(
      <ViewSwitcher
        experimentId="E0001-demo"
        views={views({ canMutate: true, views: [view], activeView: view, error: 'boom' })}
        onActiveViewReplaced={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /Duplicate/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Rename Results view' })).toBeEnabled()
    expect(screen.getByRole('status')).toHaveTextContent('boom')
    expect(screen.getByRole('combobox', { name: 'Results view' })).toHaveTextContent('Default')
  })
})

describe('ColumnToolbar', () => {
  it('summarizes columns and locks for viewers', () => {
    const { container } = render(
      <ColumnToolbar
        experimentId="E0001-demo"
        locked
        visibleCount={3}
        totalCount={9}
        hiddenCount={6}
        showAllColumns
        onShowAllColumnsChange={vi.fn()}
        maxLines={2}
        onMaxLinesChange={vi.fn()}
        resetDisabled
        onReset={vi.fn()}
      />,
    )
    expect(container.firstElementChild).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText('3/9 shown')).toBeInTheDocument()
    expect(screen.getByText('6 saved hidden · paused')).toBeInTheDocument()
    expect(screen.getByLabelText('Maximum lines per results cell')).toHaveValue(2)
    expect(screen.getByRole('button', { name: /Reset view/ })).toBeDisabled()
  })
})

describe('FilterBar', () => {
  it('renders filter and sort badges with the temporary sort', () => {
    const { container } = render(
      <FilterBar
        experimentId="E0001-demo"
        locked={false}
        shownRowCount={1}
        totalRowCount={2}
        columns={COLUMNS}
        domains={new Map()}
        rowFilters={[{ id: 'f1', columnId: 'params.lr', operator: 'gt', value: '0.005' }]}
        rowOverrideCount={1}
        showAllRows={false}
        onShowAllRowsChange={vi.fn()}
        defaultSortRules={[{ id: 's1', columnId: 'metrics.loss', direction: 'asc' }]}
        temporarySort={{ columnId: 'params.lr', direction: 'desc' }}
        temporarySortLabel="Learning rate"
        drag={NO_DRAG}
        onSaveFilter={vi.fn()}
        onRemoveFilter={vi.fn()}
        onSaveSort={vi.fn()}
        onRemoveSort={vi.fn()}
        onMoveSort={vi.fn()}
        onClearTemporarySort={vi.fn()}
      />,
    )
    expect(container.querySelector('[data-slot="row-filter-controls"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="default-sort-controls"]')).not.toBeNull()
    expect(screen.getByText('1/2 shown')).toBeInTheDocument()
    expect(screen.getByText('1 override')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Edit filter 1 Learning rate > 0.005' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Edit sort 1 Final loss ascending' }),
    ).toBeInTheDocument()
    expect(container.querySelector('[data-temporary-sort]')).toHaveTextContent(
      'Temporary · Learning rate ↓',
    )
    expect(screen.getByText(/then Variant/)).toBeInTheDocument()
  })
})

describe('shadcn primitives are composed, never forked', () => {
  it('leaves components/ui unchanged', () => {
    const root = resolve(__dirname, '../..')
    const changed = execFileSync('git', ['status', '--porcelain', '--', 'components/ui'], {
      cwd: root,
      encoding: 'utf8',
    })
    expect(changed).toBe('')
  })
})
