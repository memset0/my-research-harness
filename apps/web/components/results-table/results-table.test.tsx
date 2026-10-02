import type { ResultsDocument } from '@memon/core'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { buildColumns } from '../../lib/experiment-results/columns'
import type { ResultTableColumn } from '../../lib/experiment-results/types'
import { ResultCell, StatusCell } from './cells'
import type { ColumnHeaderActions } from './column-header'
import { ColumnOptions } from './column-options'
import { ColumnToolbar } from './column-toolbar'
import { FilterBar } from './filter-bar'
import { ResultsGrid } from './results-grid'
import type { DragHandlers } from './use-drag-reorder'
import { type ViewCollection, ViewSwitcher } from './view-switcher'

const DOCUMENT: ResultsDocument = {
  schemaVersion: 1,
  columns: [
    { key: 'lr', label: 'Learning rate', group: 'parameter', type: 'number' },
    { key: 'loss', label: 'Final loss', group: 'metric', type: 'number' },
  ],
  variants: [
    {
      id: 'V0001',
      name: 'Baseline',
      status: 'COMPLETED',
      parameters: { lr: 0.001 },
      metrics: { loss: 0.123456 },
      runs: ['run-a', 'run-x'],
      attempts: [],
    },
    {
      id: 'V0002',
      name: 'Faster',
      status: 'FAILED',
      parameters: { lr: 0.01 },
      metrics: { loss: null },
      runs: [],
      attempts: [],
    },
  ],
}

const COLUMNS = buildColumns(DOCUMENT)
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
  onPin: vi.fn(),
  onToggleStar: vi.fn(),
  onSetSotaMode: vi.fn(),
  onSetDecimalPlaces: vi.fn(),
}

describe('ResultsGrid', () => {
  it('renders the shadcn table with header labels and formatted cells', () => {
    const { container } = render(
      <ResultsGrid
        columns={[column('variant'), column('schema:lr'), column('schema:loss'), column('runs')]}
        variants={DOCUMENT.variants}
        context={{
          project: 'project-a',
          experimentId: 'E0001-demo',
          declaredRunIds: new Set(['run-a']),
          maxLines: 2,
          starredLabels: new Set(['Final loss']),
          pinnedColumnSide: new Map([['variant', 'left']]),
          sotaRanks: new Map([['schema:loss', { ranks: new Map([['V0001', 1]]), active: true }]]),
          decimalPlaces: { 'schema:loss': 2 },
        }}
        eligibilityByVariant={new Map()}
        rowOverrides={{ V0002: 'exclude' }}
        temporarySort={{ columnId: 'schema:lr', direction: 'desc' }}
        sotaModes={{ 'schema:loss': 'lower-is-better' }}
        canMutate
        drag={NO_DRAG}
        headerActions={NO_ACTIONS}
        onSetRowOverride={vi.fn()}
      />,
    )
    const table = container.querySelector('[data-slot="table"]') as HTMLElement
    expect(table).toHaveAttribute('data-results-table-grid')
    const headers = within(table).getAllByRole('columnheader')
    expect(headers.map((header) => header.textContent)).toEqual([
      expect.stringContaining('Variant'),
      expect.stringContaining('Learning rate'),
      expect.stringContaining('Final loss'),
      expect.stringContaining('Runs'),
    ])
    expect(headers[1]).toHaveAttribute('aria-sort', 'descending')
    expect(headers[0]).toHaveAttribute('data-pinned', 'left')
    expect(headers[2]).toHaveAttribute('data-column-group', 'metric')

    const loss = table.querySelector('[data-variant-id="V0001"] [data-column-id="schema:loss"]')
    expect(loss).toHaveTextContent('0.12')
    expect(loss?.querySelector('span')).toHaveClass('font-bold', 'underline')
    expect(loss?.querySelector('[data-max-lines="2"]')).not.toBeNull()
    expect(table.querySelector('[data-variant-id="V0002"]')).toHaveAttribute(
      'data-row-override',
      'exclude',
    )
    expect(within(table).getByRole('link', { name: 'run-a' })).toHaveAttribute(
      'href',
      '/p/project-a/e/E0001-demo?run=run-a',
    )
    expect(within(table).queryByRole('link', { name: 'run-x' })).toBeNull()
  })
})

describe('cells', () => {
  it('renders status badges and empty values', () => {
    const { container } = render(
      <>
        <StatusCell status="RUNNING" />
        <ResultCell
          column={column('schema:loss')}
          variant={DOCUMENT.variants[1]!}
          project="project-a"
          experimentId="E0001-demo"
          declaredRunIds={new Set()}
        />
      </>,
    )
    expect(container.querySelector('[data-slot="badge"]')).toHaveTextContent('RUNNING')
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('renders a BLOCKED Variant through the status badge in the Status column', () => {
    const blocked = { ...DOCUMENT.variants[0]!, id: 'V0003', status: 'BLOCKED' as const }
    const { container } = render(
      <ResultCell
        column={column('status')}
        variant={blocked}
        project="project-a"
        experimentId="E0001-demo"
        declaredRunIds={new Set()}
      />,
    )
    const badge = container.querySelector('[data-slot="badge"]')
    expect(badge).toHaveTextContent('BLOCKED')
    expect(badge).toHaveAttribute('data-status', 'BLOCKED')
    expect(badge).toHaveClass('border-dashed', 'border-orange-400', 'bg-orange-50')
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

describe('ColumnOptions', () => {
  it('renders one draggable chip per column with star state and pin badge', () => {
    const { container } = render(
      <ColumnOptions
        experimentId="E0001-demo"
        locked={false}
        columns={COLUMNS}
        hiddenColumnIds={new Set(['status'])}
        domains={new Map([['schema:lr', ['0.001', '0.01']]])}
        starredLabels={new Set(['Learning rate'])}
        pinnedColumnSide={new Map([['schema:lr', 'right']])}
        drag={NO_DRAG}
        onVisibleChange={vi.fn()}
        onToggleStar={vi.fn()}
      />,
    )
    expect(container.querySelectorAll('[data-column-option]')).toHaveLength(COLUMNS.length)
    expect(screen.getByRole('checkbox', { name: 'Show Status column' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Unstar Learning rate column' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByLabelText('Pinned right')).toBeInTheDocument()
    expect(container.querySelector('[data-column-option="schema:loss"]')).toHaveAttribute(
      'data-column-group',
      'metric',
    )
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
        rowFilters={[{ id: 'f1', columnId: 'schema:lr', operator: 'gt', value: '0.005' }]}
        rowOverrideCount={1}
        showAllRows={false}
        onShowAllRowsChange={vi.fn()}
        defaultSortRules={[{ id: 's1', columnId: 'schema:loss', direction: 'asc' }]}
        temporarySort={{ columnId: 'schema:lr', direction: 'desc' }}
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
