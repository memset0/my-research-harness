import type { ResultsDocument } from '@memon/core'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExperimentResultsTable } from './experiment-results-table'

const RESULTS: ResultsDocument = {
  schemaVersion: 1,
  columns: [
    { key: 'lr', label: 'Learning rate', group: 'parameter', type: 'number' },
    { key: 'loss', label: 'Final loss', group: 'metric', type: 'number' },
    { key: 'notes', label: 'Notes', group: 'metric', type: 'string' },
  ],
  variants: [
    {
      id: 'V0002',
      name: 'Second in YAML',
      status: 'COMPLETED',
      parameters: { lr: 0.002 },
      metrics: { loss: 0.2, notes: 'first line<br>second line' },
      runs: ['run-b', 'run-c'],
      attempts: [],
    },
    {
      id: 'V0001',
      name: 'First by metric',
      status: 'RUNNING',
      parameters: { lr: 0.001 },
      metrics: { loss: 0.1, notes: 'single line' },
      runs: ['run-a'],
      attempts: ['run-failed'],
      provenance: {
        repo: 'https://github.com/example/research.git',
        commit: '1234567890abcdef',
        entry: 'train.py',
        recipe: 'recipes/base.yaml',
      },
    },
    {
      id: 'V0003',
      name: 'Missing metric',
      status: 'PLANNED',
      parameters: { lr: 0.003 },
      metrics: { loss: null, notes: 'single line' },
      runs: [],
      attempts: [],
    },
  ],
}

const WANDB_URL = 'https://wandb.ai/acme/research/runs/a1b2c3d4e5f67890?nw=nwuser'
const URL_RESULTS: ResultsDocument = {
  ...RESULTS,
  columns: [
    ...RESULTS.columns,
    { key: 'tracking', label: 'Tracking', group: 'metric', type: 'string' },
  ],
  variants: RESULTS.variants.map((variant) => ({
    ...variant,
    metrics: {
      ...variant.metrics,
      tracking:
        variant.id === 'V0002'
          ? WANDB_URL
          : variant.id === 'V0001'
            ? 'https://github.com/example/research/actions/runs/1234'
            : null,
    },
  })),
}

describe('ExperimentResultsTable', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: memoryStorage(),
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Forbidden', { status: 403 })))
  })

  afterEach(() => vi.unstubAllGlobals())

  it('uses YAML column order, clamps to one line, scrolls horizontally, and renders br as breaks', async () => {
    const user = userEvent.setup()
    const { container } = renderResults('E0001-results')
    const table = screen.getByRole('table')

    expect(
      within(table)
        .getAllByRole('columnheader')
        .map(
          (header) =>
            header.querySelector<HTMLElement>('[data-column-label]')?.textContent ??
            header.textContent,
        ),
    ).toEqual([
      'Variant',
      'Status',
      'Learning rate',
      'Final loss',
      'Notes',
      'Entry',
      'Recipe',
      'Commit',
      'Runs',
      'Attempts',
    ])
    expect(table).toHaveClass('table-auto', 'w-max', 'min-w-full')
    expect(table.parentElement).toHaveClass('overflow-x-auto')
    expect(screen.getByRole('link', { name: 'W&B' })).toHaveAttribute(
      'href',
      'https://wandb.example/run-a',
    )
    expect(container.querySelector('[data-max-lines="1"]')).toHaveStyle({
      maxHeight: 'calc(1 * 1.25rem)',
    })
    expect(screen.queryByText(/<br>/)).not.toBeInTheDocument()
    const notesCell = table.querySelector(
      '[data-variant-id="V0002"] [data-column-id="schema:notes"]',
    )
    expect(notesCell?.querySelectorAll('br')).toHaveLength(1)

    const lossOption = container.querySelector<HTMLElement>('[data-column-option="schema:loss"]')!
    const learningRateOption = container.querySelector<HTMLElement>(
      '[data-column-option="schema:lr"]',
    )!
    expect(lossOption).toHaveAttribute('data-column-group', 'metric')
    expect(lossOption).toHaveClass('bg-sky-50/60')
    expect(within(lossOption).queryByText('Metric')).not.toBeInTheDocument()
    expect(learningRateOption).toHaveAttribute('data-column-group', 'parameter')
    expect(learningRateOption).not.toHaveClass('bg-sky-50/60')
    expect(within(learningRateOption).queryByText('Metric')).not.toBeInTheDocument()

    const lossHeader = table.querySelector<HTMLElement>('thead [data-column-id="schema:loss"]')!
    const lossCell = table.querySelector<HTMLElement>(
      '[data-variant-id="V0001"] [data-column-id="schema:loss"]',
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

  it('renders wandb.ai values as compact chart links with the full URL on hover', async () => {
    const user = userEvent.setup()
    const { container } = renderResults('E0001-url-results', URL_RESULTS)

    const wandbLink = screen.getByRole('link', {
      name: 'Open W&B link a1b2c3d4e5f67890',
    })
    expect(wandbLink).toHaveAttribute('href', WANDB_URL)
    expect(wandbLink).toHaveAttribute('target', '_blank')
    expect(wandbLink).toHaveTextContent('a1b2c3d4e5f67890')
    expect(wandbLink).toHaveClass('text-primary', 'underline')
    expect(wandbLink.querySelector('svg')).toHaveClass('lucide-chart-spline')
    expect(wandbLink).not.toHaveTextContent(WANDB_URL)

    await user.hover(wandbLink)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(WANDB_URL)

    const ordinaryUrlCell = container.querySelector(
      '[data-variant-id="V0001"] [data-column-id="schema:tracking"]',
    )
    expect(ordinaryUrlCell).toHaveTextContent(
      'https://github.com/example/research/actions/runs/1234',
    )
    expect(ordinaryUrlCell?.querySelector('a')).toBeNull()
  })

  it('keeps header sorting temporary while persisting visibility, line count, and stars', async () => {
    const user = userEvent.setup()
    const first = renderResults('E0001-results')

    const sortButton = screen.getByRole('button', {
      name: 'Final loss: default sort; activate for temporary ascending',
    })
    await user.click(sortButton)
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
    expect(
      screen.getByRole('button', {
        name: 'Final loss: default sort; activate for temporary ascending',
      }),
    ).toBeInTheDocument()

    fireEvent.contextMenu(screen.getByRole('columnheader', { name: /Notes/ }))
    expect(await screen.findByRole('menuitem', { name: 'Star column' })).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'Hide column' }))
    expect(screen.queryByRole('columnheader', { name: /Notes/ })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Show Notes column' })).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Show all columns temporarily' }))
    expect(screen.getByRole('columnheader', { name: /Notes/ })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Show Notes column' })).not.toBeChecked()
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
      const preferences = JSON.parse(
        window.localStorage.getItem('memon:results-table:research:E0001-results:preferences') ??
          '{}',
      ) as {
        hiddenColumnIds?: string[]
        maxLines?: number
        sort?: unknown
        defaultSortRules?: unknown[]
      }
      expect(preferences.hiddenColumnIds).toContain('schema:notes')
      expect(preferences.maxLines).toBe(3)
      expect(preferences.sort).toBeUndefined()
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

  it('persists an ordered default sort chain and keeps header sort temporary', async () => {
    const user = userEvent.setup()
    const first = renderResults('E0001-default-sort')

    expect(variantOrder()).toEqual(['V0001', 'V0002', 'V0003'])
    expect(screen.getByText('Variant ↑')).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', {
        name: 'Variant: default sort; activate for temporary ascending',
      }),
    )
    await user.click(
      screen.getByRole('button', {
        name: 'Variant: temporarily sorted ascending; activate for descending',
      }),
    )
    expect(variantOrder()).toEqual(['V0003', 'V0002', 'V0001'])
    await user.click(
      screen.getByRole('button', {
        name: 'Variant: temporarily sorted descending; activate for default sort',
      }),
    )
    expect(variantOrder()).toEqual(['V0001', 'V0002', 'V0003'])

    await addDefaultSort(user, 'Notes', 'Large to small (descending)')
    expect(variantOrder()).toEqual(['V0001', 'V0003', 'V0002'])
    await addDefaultSort(user, 'Learning rate', 'Large to small (descending)')
    expect(variantOrder()).toEqual(['V0003', 'V0001', 'V0002'])

    await user.click(screen.getByRole('button', { name: 'Edit sort 2 Learning rate descending' }))
    await chooseSelectOption(user, 'Sort direction', 'Small to large (ascending)')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(variantOrder()).toEqual(['V0001', 'V0003', 'V0002'])

    await user.click(
      screen.getByRole('button', {
        name: 'Final loss: default sort; activate for temporary ascending',
      }),
    )
    expect(variantOrder()).toEqual(['V0001', 'V0002', 'V0003'])
    expect(first.container.querySelector('[data-temporary-sort]')).toHaveTextContent(
      'Temporary · Final loss ↑',
    )
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
    expect(variantOrder()).toEqual(['V0001', 'V0003', 'V0002'])

    await waitFor(() => {
      const preferences = JSON.parse(
        window.localStorage.getItem(
          'memon:results-table:research:E0001-default-sort:preferences',
        ) ?? '{}',
      ) as { defaultSortRules?: Array<{ columnId?: string; direction?: string }> }
      expect(preferences.defaultSortRules).toMatchObject([
        { columnId: 'schema:notes', direction: 'desc' },
        { columnId: 'schema:lr', direction: 'asc' },
      ])
    })

    first.unmount()
    renderResults('E0001-default-sort')
    await waitFor(() => expect(variantOrder()).toEqual(['V0001', 'V0003', 'V0002']))
    expect(screen.queryByText(/Temporary ·/)).not.toBeInTheDocument()
  })

  it('persists AND row filters and force overrides while show-all remains temporary', async () => {
    const user = userEvent.setup()
    const first = renderResults('E0001-row-filters')

    expect(screen.queryByRole('combobox', { name: 'Override row' })).not.toBeInTheDocument()
    await addRowFilter(user, 'Final loss', 'Greater than (>)', '0.15')
    expect(variantOrder()).toEqual(['V0002'])

    await user.click(screen.getByRole('button', { name: 'Edit filter Final loss > 0.15' }))
    await user.clear(screen.getByLabelText('Filter value'))
    await user.type(screen.getByLabelText('Filter value'), '0.05')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(variantOrder()).toEqual(['V0001', 'V0002'])
    await user.click(screen.getByRole('button', { name: 'Edit filter Final loss > 0.05' }))
    await user.clear(screen.getByLabelText('Filter value'))
    await user.type(screen.getByLabelText('Filter value'), '0.15')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await addRowFilter(user, 'Final loss', 'Less than (<)', '0.25')
    expect(variantOrder()).toEqual(['V0002'])

    await addRowFilter(user, 'Status', 'Equals (=)', 'COMPLETED')
    await addRowFilter(user, 'Notes', 'Does not equal (≠)', 'single line')
    expect(variantOrder()).toEqual(['V0002'])
    expect(first.container.querySelectorAll('[data-row-filter]')).toHaveLength(4)
    expect(screen.queryByText('Auto')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show all rows temporarily' }))
    fireEvent.contextMenu(first.container.querySelector('[data-variant-id="V0001"]')!)
    await user.click(await screen.findByRole('menuitem', { name: 'Force show row' }))
    await user.click(screen.getByRole('button', { name: 'Resume saved row filters' }))
    expect(variantOrder()).toEqual(['V0001', 'V0002'])

    fireEvent.contextMenu(first.container.querySelector('[data-variant-id="V0002"]')!)
    await user.click(await screen.findByRole('menuitem', { name: 'Force hide row' }))
    expect(variantOrder()).toEqual(['V0001'])

    await user.click(screen.getByRole('button', { name: 'Show all rows temporarily' }))
    expect(variantOrder()).toEqual(['V0001', 'V0002', 'V0003'])
    fireEvent.contextMenu(first.container.querySelector('[data-variant-id="V0002"]')!)
    await user.click(await screen.findByRole('menuitem', { name: 'Force show row' }))
    await user.click(screen.getByRole('button', { name: 'Resume saved row filters' }))
    expect(variantOrder()).toEqual(['V0001', 'V0002'])

    await waitFor(() => {
      const preferences = JSON.parse(
        window.localStorage.getItem('memon:results-table:research:E0001-row-filters:preferences') ??
          '{}',
      ) as {
        rowFilters?: Array<{ operator?: string }>
        rowOverrides?: Record<string, string>
      }
      expect(preferences.rowFilters?.map((filter) => filter.operator)).toEqual([
        'gt',
        'lt',
        'eq',
        'neq',
      ])
      expect(preferences.rowOverrides).toEqual({ V0001: 'include', V0002: 'include' })
    })

    first.unmount()
    renderResults('E0001-row-filters')
    await waitFor(() => expect(variantOrder()).toEqual(['V0001', 'V0002']))
    expect(screen.getByRole('button', { name: 'Show all rows temporarily' })).toHaveAttribute(
      'data-state',
      'off',
    )
  })

  it('pins columns in user-selected side order and falls back to grouped scrolling', async () => {
    const user = userEvent.setup()
    const first = renderResults('E0001-pins')
    const table = screen.getByRole('table')
    let viewportWidth = 500
    Object.defineProperty(table.parentElement, 'clientWidth', {
      configurable: true,
      get: () => viewportWidth,
    })
    for (const header of within(table).getAllByRole('columnheader')) {
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

    await chooseHeaderAction(user, 'Commit', 'Pin left')
    await chooseHeaderAction(user, 'Final loss', 'Pin left')
    await chooseHeaderAction(user, 'Notes', 'Pin right')

    expect(headerIds(table)).toEqual([
      'commit',
      'schema:loss',
      'variant',
      'status',
      'schema:lr',
      'entry',
      'recipe',
      'runs',
      'attempts',
      'schema:notes',
    ])
    expect(
      Array.from(first.container.querySelectorAll<HTMLElement>('[data-column-option]')).map(
        (option) => option.dataset.columnOption,
      ),
    ).toEqual([
      'variant',
      'status',
      'schema:lr',
      'schema:loss',
      'schema:notes',
      'entry',
      'recipe',
      'commit',
      'runs',
      'attempts',
    ])
    await waitFor(() => {
      expect(screen.getByRole('columnheader', { name: /Commit/ })).toHaveClass('sticky')
      expect(screen.getByRole('columnheader', { name: /Final loss/ })).toHaveStyle({
        left: '120px',
      })
      expect(screen.getByRole('columnheader', { name: /Notes/ })).toHaveStyle({ right: '0px' })
    })

    viewportWidth = 360
    fireEvent(window, new Event('resize'))
    await waitFor(() =>
      expect(screen.getByRole('columnheader', { name: /Commit/ })).not.toHaveClass('sticky'),
    )
    expect(headerIds(table).slice(0, 2)).toEqual(['commit', 'schema:loss'])
    expect(headerIds(table).at(-1)).toBe('schema:notes')
    expect(screen.getByRole('columnheader', { name: /Commit/ })).toHaveAttribute(
      'data-pinned',
      'left',
    )

    await waitFor(() => {
      const preferences = JSON.parse(
        window.localStorage.getItem('memon:results-table:research:E0001-pins:preferences') ?? '{}',
      ) as { pinnedColumnIds?: { left?: string[]; right?: string[] } }
      expect(preferences.pinnedColumnIds).toEqual({
        left: ['commit', 'schema:loss'],
        right: ['schema:notes'],
      })
    })

    first.unmount()
    renderResults('E0001-pins')
    await waitFor(() => expect(headerIds(screen.getByRole('table'))[0]).toBe('commit'))
    expect(headerIds(screen.getByRole('table')).at(-1)).toBe('schema:notes')
  })
})

function renderResults(experimentId: string, document: ResultsDocument = RESULTS) {
  return render(
    <ExperimentResultsTable
      document={document}
      project="research"
      experimentId={experimentId}
      memberRuns={[
        runSummary('run-a', 'https://wandb.example/run-a'),
        runSummary('run-b'),
        runSummary('run-c'),
      ]}
    />,
  )
}

function runSummary(id: string, wandb?: string) {
  return {
    id,
    status: 'FINISHED',
    createdAt: '2026-08-13T00:00:00Z',
    updatedAt: '2026-08-13T00:00:00Z',
    finishedAt: '2026-08-13T01:00:00Z',
    host: 'worker',
    gpus: [],
    artifacts: [],
    wandb: wandb ?? null,
  }
}

function variantOrder(): string[] {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.getAttribute('data-variant-id'))
    .filter((id): id is string => id !== null)
}

function headerIds(table: HTMLElement): string[] {
  return within(table)
    .getAllByRole('columnheader')
    .map((header) => header.getAttribute('data-column-id'))
    .filter((id): id is string => id !== null)
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
