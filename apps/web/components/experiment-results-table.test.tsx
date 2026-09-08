import type { ResultsDocument, ResultsVariantEligibility } from '@memon/core'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

const ANNOTATED_RESULTS: ResultsDocument = {
  ...RESULTS,
  columnAnnotations: {
    lr: {
      description: 'Controls the **optimizer step size**.',
      valueDescriptions: {
        '0.001': 'The **conservative** baseline.',
      },
    },
  },
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
    expect(screen.queryByText(/Pale-blue columns are metrics/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Click filter or sort badges/)).not.toBeInTheDocument()
  })

  it('shows Markdown descriptions when annotated headers and values are hovered', async () => {
    const user = userEvent.setup()
    const { container } = renderResults('E0001-annotations', ANNOTATED_RESULTS)
    const headerButton = container.querySelector<HTMLElement>(
      '[data-column-id="schema:lr"] button[data-has-description="true"]',
    )!
    expect(headerButton).toBeInTheDocument()

    await user.hover(headerButton)
    const columnTooltip = await screen.findByLabelText('Learning rate column description')
    expect(
      within(columnTooltip).getByText('optimizer step size', { exact: false }),
    ).toBeInTheDocument()
    expect(columnTooltip.querySelector('strong')).toHaveTextContent('optimizer step size')
    await user.unhover(headerButton)
    await waitFor(() => {
      expect(screen.queryByLabelText('Learning rate column description')).not.toBeInTheDocument()
    })

    const describedCell = container.querySelector<HTMLElement>(
      '[data-variant-id="V0001"] [data-column-id="schema:lr"] [data-has-description="true"]',
    )!
    expect(describedCell).toHaveAttribute('tabindex', '0')
    await user.hover(describedCell)
    const valueTooltip = await screen.findByLabelText('Learning rate value description')
    expect(within(valueTooltip).getByText('conservative', { exact: false })).toBeInTheDocument()
    expect(valueTooltip.querySelector('strong')).toHaveTextContent('conservative')

    const undescribedCell = container.querySelector<HTMLElement>(
      '[data-variant-id="V0002"] [data-column-id="schema:lr"]',
    )!
    expect(undescribedCell.querySelector('[data-has-description]')).not.toBeInTheDocument()
  })

  it('shares persisted column order between checkbox controls and draggable headers', async () => {
    const user = userEvent.setup()
    const first = renderResults('E0001-column-order')
    const table = screen.getByRole('table')

    await user.click(screen.getByRole('checkbox', { name: 'Show Final loss column' }))
    dragBefore(
      first.container.querySelector<HTMLElement>('[data-column-option="schema:notes"]')!,
      first.container.querySelector<HTMLElement>('[data-column-option="variant"]')!,
    )
    expect(columnOptionIds(first.container).slice(0, 4)).toEqual([
      'schema:notes',
      'variant',
      'status',
      'schema:lr',
    ])
    expect(headerIds(table).slice(0, 4)).toEqual(['schema:notes', 'variant', 'status', 'schema:lr'])

    dragBefore(
      table.querySelector<HTMLElement>('thead [data-column-id="schema:lr"]')!,
      table.querySelector<HTMLElement>('thead [data-column-id="schema:notes"]')!,
    )
    expect(columnOptionIds(first.container).slice(0, 4)).toEqual([
      'schema:lr',
      'schema:notes',
      'variant',
      'status',
    ])
    expect(headerIds(table).slice(0, 4)).toEqual(['schema:lr', 'schema:notes', 'variant', 'status'])

    await waitFor(() => {
      const preferences = JSON.parse(
        window.localStorage.getItem(
          'memon:results-table:research:E0001-column-order:preferences',
        ) ?? '{}',
      ) as { columnOrderIds?: string[]; hiddenColumnIds?: string[] }
      expect(preferences.columnOrderIds?.slice(0, 5)).toEqual([
        'schema:lr',
        'schema:notes',
        'variant',
        'status',
        'schema:loss',
      ])
      expect(preferences.hiddenColumnIds).toContain('schema:loss')
    })

    first.unmount()
    const restored = renderResults('E0001-column-order')
    await waitFor(() =>
      expect(columnOptionIds(restored.container).slice(0, 4)).toEqual([
        'schema:lr',
        'schema:notes',
        'variant',
        'status',
      ]),
    )
    expect(headerIds(screen.getByRole('table')).slice(0, 4)).toEqual([
      'schema:lr',
      'schema:notes',
      'variant',
      'status',
    ])
    expect(screen.getByRole('checkbox', { name: 'Show Final loss column' })).not.toBeChecked()
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

    expect(loss).not.toBeChecked()
    expect(notes).not.toBeChecked()
    await waitFor(() => {
      const preferences = JSON.parse(
        window.localStorage.getItem(
          'memon:results-table:research:E0001-batched-checkboxes:preferences',
        ) ?? '{}',
      ) as { hiddenColumnIds?: string[] }
      expect(preferences.hiddenColumnIds).toEqual(
        expect.arrayContaining(['schema:loss', 'schema:notes']),
      )
    })

    first.unmount()
    renderResults('E0001-batched-checkboxes')
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'Show Final loss column' })).not.toBeChecked(),
    )
    expect(screen.getByRole('checkbox', { name: 'Show Notes column' })).not.toBeChecked()
  })

  it('normalizes a partial saved column order and appends current document columns', async () => {
    window.localStorage.setItem(
      'memon:results-table:research:E0001-partial-order:preferences',
      JSON.stringify({
        columnOrderIds: ['schema:notes', 'stale-column', 'schema:notes', 'variant'],
      }),
    )

    const rendered = renderResults('E0001-partial-order')
    await waitFor(() =>
      expect(columnOptionIds(rendered.container)).toEqual([
        'schema:notes',
        'variant',
        'status',
        'schema:lr',
        'schema:loss',
        'entry',
        'recipe',
        'commit',
        'runs',
        'attempts',
      ]),
    )
    expect(headerIds(screen.getByRole('table'))).toEqual(columnOptionIds(rendered.container))
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

    const preferenceKey = 'memon:results-table:research:E0001-reset-confirmation:preferences'
    await waitFor(() => {
      const preferences = JSON.parse(window.localStorage.getItem(preferenceKey) ?? '{}') as {
        defaultSortRules?: unknown[]
        hiddenColumnIds?: string[]
        maxLines?: number
      }
      expect(preferences.defaultSortRules).toHaveLength(1)
      expect(preferences.hiddenColumnIds).toContain('schema:notes')
      expect(preferences.maxLines).toBe(3)
    })
    const configuredPreferences = window.localStorage.getItem(preferenceKey)
    const resetButton = screen.getByRole('button', { name: 'Reset view' })
    const notesCheckbox = screen.getByRole('checkbox', { name: 'Show Notes column' })
    const maxLinesInput = screen.getByRole('spinbutton', {
      name: 'Maximum lines per results cell',
    })
    const temporarySortBadge = screen.getByText('Temporary · Learning rate ↑')

    await user.click(resetButton)
    const dialog = await screen.findByRole('dialog', { name: 'Reset Results view?' })
    expect(dialog).toHaveTextContent('saved default sort')
    expect(dialog).toHaveTextContent('checkbox visibility')
    expect(dialog).toHaveTextContent('This cannot be undone')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus())
    expect(window.localStorage.getItem(preferenceKey)).toBe(configuredPreferences)
    expect(notesCheckbox).not.toBeChecked()
    expect(maxLinesInput).toHaveValue(3)
    expect(temporarySortBadge).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'Reset Results view?' })).not.toBeInTheDocument()
    expect(window.localStorage.getItem(preferenceKey)).toBe(configuredPreferences)

    await user.click(resetButton)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Reset Results view?' })).not.toBeInTheDocument()
    expect(window.localStorage.getItem(preferenceKey)).toBe(configuredPreferences)
    expect(screen.getByRole('checkbox', { name: 'Show Notes column' })).not.toBeChecked()

    await user.click(resetButton)
    await user.click(screen.getByRole('button', { name: 'Confirm reset Results view' }))
    expect(screen.queryByRole('dialog', { name: 'Reset Results view?' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Show Notes column' })).toBeChecked()
    expect(screen.getByRole('spinbutton', { name: 'Maximum lines per results cell' })).toHaveValue(
      1,
    )
    expect(screen.queryByText('Temporary · Learning rate ↑')).not.toBeInTheDocument()
    expect(resetButton).toBeDisabled()
    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem(preferenceKey) ?? '{}')).toEqual({
        hiddenColumnIds: [],
        columnOrderIds: [],
        maxLines: 1,
        defaultSortRules: [],
        pinnedColumnIds: { left: [], right: [] },
        rowFilters: [],
        rowOverrides: {},
        sotaModes: {},
        decimalPlaces: {},
      }),
    )
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

    const sortRules = first.container.querySelectorAll<HTMLElement>('[data-sort-rule-order]')
    dragBefore(sortRules[1]!, sortRules[0]!)
    expect(
      screen.getByRole('button', { name: 'Edit sort 1 Learning rate ascending' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit sort 2 Notes descending' })).toBeInTheDocument()
    expect(variantOrder()).toEqual(['V0001', 'V0002', 'V0003'])

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
    expect(variantOrder()).toEqual(['V0001', 'V0002', 'V0003'])

    await waitFor(() => {
      const preferences = JSON.parse(
        window.localStorage.getItem(
          'memon:results-table:research:E0001-default-sort:preferences',
        ) ?? '{}',
      ) as { defaultSortRules?: Array<{ columnId?: string; direction?: string }> }
      expect(preferences.defaultSortRules).toMatchObject([
        { columnId: 'schema:lr', direction: 'asc' },
        { columnId: 'schema:notes', direction: 'desc' },
      ])
    })

    first.unmount()
    renderResults('E0001-default-sort')
    await waitFor(() => expect(variantOrder()).toEqual(['V0001', 'V0002', 'V0003']))
    expect(screen.queryByText(/Temporary ·/)).not.toBeInTheDocument()
  })

  it('persists AND row filters and force overrides while show-all remains temporary', async () => {
    const user = userEvent.setup()
    const first = renderResults('E0001-row-filters')

    expect(screen.queryByRole('combobox', { name: 'Override row' })).not.toBeInTheDocument()
    await addRowFilter(user, 'Final loss', 'Greater than (>)', '0.15')
    expect(variantOrder()).toEqual(['V0002'])

    await user.click(screen.getByRole('button', { name: 'Edit filter 1 Final loss > 0.15' }))
    await user.clear(screen.getByLabelText('Filter value'))
    await user.type(screen.getByLabelText('Filter value'), '0.05')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(variantOrder()).toEqual(['V0001', 'V0002'])
    await user.click(screen.getByRole('button', { name: 'Edit filter 1 Final loss > 0.05' }))
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

    const filterRules = first.container.querySelectorAll<HTMLElement>('[data-row-filter-order]')
    dragBefore(filterRules[3]!, filterRules[0]!)
    expect(
      screen.getByRole('button', { name: 'Edit filter 1 Notes ≠ single line' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Edit filter 2 Final loss > 0.15' }),
    ).toBeInTheDocument()
    expect(variantOrder()).toEqual(['V0002'])

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

    first.unmount()
    const restored = renderResults('E0001-row-filters')
    await waitFor(() => expect(variantOrder()).toEqual(['V0001', 'V0002']))
    expect(
      within(restored.container.querySelector<HTMLElement>('[data-row-filter-order]')!).getByText(
        '1',
      ),
    ).toBeInTheDocument()
    expect(
      restored.container.querySelector<HTMLElement>('[data-row-filter-order]'),
    ).toHaveTextContent('Notes')
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
      expect(screen.getByRole('columnheader', { name: /Commit/ })).toHaveClass('!bg-muted')
      expect(screen.getByRole('columnheader', { name: /Final loss/ })).toHaveStyle({
        left: '120px',
      })
      expect(screen.getByRole('columnheader', { name: /Final loss/ })).toHaveClass(
        '!bg-sky-50',
        'dark:!bg-sky-950',
      )
      expect(screen.getByRole('columnheader', { name: /Notes/ })).toHaveStyle({ right: '0px' })
      expect(
        table.querySelector('[data-variant-id="V0001"] [data-column-id="commit"]'),
      ).toHaveClass('!bg-background')
      expect(
        table.querySelector('[data-variant-id="V0001"] [data-column-id="schema:loss"]'),
      ).toHaveClass('!bg-sky-50', 'dark:!bg-sky-950')
    })

    await chooseHeaderAction(user, 'Final loss', 'Star column')
    expect(screen.getByRole('columnheader', { name: /Final loss/ })).toHaveClass(
      '!bg-amber-50',
      'dark:!bg-amber-950',
    )
    expect(
      table.querySelector('[data-variant-id="V0001"] [data-column-id="schema:loss"]'),
    ).toHaveClass('!bg-amber-50', 'dark:!bg-amber-950')

    viewportWidth = 360
    fireEvent(window, new Event('resize'))
    await waitFor(() =>
      expect(screen.getByRole('columnheader', { name: /Commit/ })).not.toHaveClass('sticky'),
    )
    expect(screen.getByRole('columnheader', { name: /Final loss/ })).not.toHaveClass('!bg-amber-50')
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

  it('persists SOTA mode and decimal places per metric column', async () => {
    cleanup()
    const user = userEvent.setup()
    const { container, unmount: unmountA } = renderResults('E0001-sota-a')

    // Right-click the "Final loss" column header to open the context menu.
    const lossHeader = container.querySelector<HTMLElement>(
      '[data-column-id="schema:loss"] button',
    )!
    fireEvent.contextMenu(lossHeader)

    // Context menu content is portaled to document.body; query from there.
    const body = window.document.body

    // Open SOTA highlight submenu and select "Higher is better"
    const sotaTrigger = Array.from(
      body.querySelectorAll<HTMLElement>('[data-slot="context-menu-sub-trigger"]'),
    ).find((el) => el.textContent?.includes('SOTA highlight'))!
    expect(sotaTrigger).toBeDefined()
    await act(async () => {
      fireEvent.click(sotaTrigger)
    })
    const higherOption = screen.getByRole('menuitem', { name: /Higher is better/i })
    expect(higherOption).not.toBeDisabled()
    await act(async () => {
      fireEvent.click(higherOption)
    })

    // Open decimal places submenu and click + twice to get 2
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
    // SOTA highlighting and decimal formatting apply after the preference-driven
    // re-render; wait for them.
    await waitFor(() => {
      const v0002After = table.querySelector(
        '[data-variant-id="V0002"] [data-column-id="schema:loss"] span',
      )
      expect(v0002After).toHaveClass('font-bold', 'underline')
    })
    const v0001LossCell = table.querySelector(
      '[data-variant-id="V0001"] [data-column-id="schema:loss"] span',
    )
    expect(v0001LossCell).toHaveClass('font-bold')
    expect(v0001LossCell).not.toHaveClass('underline')

    // Decimal formatting: 0.1 → "0.10", 0.2 → "0.20"
    expect(v0001LossCell).toHaveTextContent('0.10')
    const v0002LossCell = table.querySelector(
      '[data-variant-id="V0002"] [data-column-id="schema:loss"] span',
    )
    expect(v0002LossCell).toHaveTextContent('0.20')

    // Non-metric column (Learning rate) should not be affected
    const lrCell = table.querySelector(
      '[data-variant-id="V0001"] [data-column-id="schema:lr"] span',
    )
    expect(lrCell).not.toHaveClass('font-bold', 'underline')
    expect(lrCell).toHaveTextContent('0.001') // no formatting

    unmountA()
    await waitFor(() => {
      const preferences = JSON.parse(
        window.localStorage.getItem('memon:results-table:research:E0001-sota-a:preferences') ??
          '{}',
      )
      expect(preferences.sotaModes).toEqual({ 'schema:loss': 'higher-is-better' })
      expect(preferences.decimalPlaces).toEqual({ 'schema:loss': 2 })
    })
  })

  it('switches SOTA mode to lower-is-better and highlights the smallest values', async () => {
    cleanup()
    const user = userEvent.setup()
    const { container, unmount: unmountB } = renderResults('E0001-sota-b')

    const lossHeader = container.querySelector<HTMLElement>(
      '[data-column-id="schema:loss"] button',
    )!
    // Start from off, cycle: off → higher → lower
    fireEvent.contextMenu(lossHeader)
    const body = window.document.body
    const sotaTriggerB = Array.from(
      body.querySelectorAll<HTMLElement>('[data-slot="context-menu-sub-trigger"]'),
    ).find((el) => el.textContent?.includes('SOTA highlight'))!
    await act(async () => {
      fireEvent.click(sotaTriggerB)
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /Higher is better/i }))
    })

    fireEvent.contextMenu(lossHeader)
    const sotaTriggerC = Array.from(
      body.querySelectorAll<HTMLElement>('[data-slot="context-menu-sub-trigger"]'),
    ).find((el) => el.textContent?.includes('SOTA highlight'))!
    await act(async () => {
      fireEvent.click(sotaTriggerC)
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /Lower is better/i }))
    })

    const table = container.querySelector('table')!
    await waitFor(() => {
      const v0001After = table.querySelector(
        '[data-variant-id="V0001"] [data-column-id="schema:loss"] span',
      )
      expect(v0001After).toHaveClass('font-bold', 'underline')
    })
    const v0002LossCell = table.querySelector(
      '[data-variant-id="V0002"] [data-column-id="schema:loss"] span',
    )
    expect(v0002LossCell).toHaveClass('font-bold')
    expect(v0002LossCell).not.toHaveClass('underline')

    unmountB()
    await waitFor(() => {
      const preferences = JSON.parse(
        window.localStorage.getItem('memon:results-table:research:E0001-sota-b:preferences') ??
          '{}',
      )
      expect(preferences.sotaModes).toEqual({ 'schema:loss': 'lower-is-better' })
    })
  })

  it('keeps excluded metrics visible without ranking them and restores ranking after eligibility changes', async () => {
    const experimentId = 'E0001-eligibility'
    window.localStorage.setItem(
      `memon:results-table:research:${experimentId}:preferences`,
      JSON.stringify({ sotaModes: { 'schema:loss': 'lower-is-better' } }),
    )
    const eligibility: ResultsVariantEligibility[] = [
      {
        variantId: 'V0001',
        runs: ['run-a'],
        deprecatedRuns: ['run-a'],
        eligibleRuns: [],
        hasMetrics: true,
        metricsValidity: 'unavailable',
      },
      {
        variantId: 'V0002',
        runs: ['run-b', 'run-c'],
        deprecatedRuns: ['run-b'],
        eligibleRuns: ['run-c'],
        hasMetrics: true,
        metricsValidity: 'partial',
      },
    ]
    const { container, rerender } = renderResults(experimentId, RESULTS, eligibility)
    const metric = (id: string) =>
      container.querySelector(`[data-variant-id="${id}"] [data-column-id="schema:loss"] span`)!
    await waitFor(() => expect(metric('V0001')).toHaveTextContent('0.1 [unavailable]'))
    expect(metric('V0002')).toHaveTextContent('0.2 [partial]')
    expect(metric('V0001')).not.toHaveClass('font-bold')
    expect(metric('V0002')).not.toHaveClass('font-bold')

    rerender(
      <ExperimentResultsTable
        document={RESULTS}
        project="research"
        experimentId={experimentId}
        runIds={['run-a', 'run-b', 'run-c']}
        variantEligibility={[
          {
            ...eligibility[0]!,
            deprecatedRuns: [],
            eligibleRuns: ['run-a'],
            metricsValidity: 'valid',
          },
          eligibility[1]!,
        ]}
      />,
    )
    await waitFor(() => expect(metric('V0001')).toHaveClass('font-bold', 'underline'))
    expect(metric('V0001')).toHaveTextContent('0.1')
    expect(metric('V0001')).not.toHaveTextContent('unavailable')
    expect(metric('V0002')).toHaveTextContent('0.2 [partial]')
    expect(metric('V0002')).not.toHaveClass('font-bold')
  })

  it('does not highlight non-numeric metric values', async () => {
    cleanup()
    const user = userEvent.setup()
    const { container, unmount } = renderResults('E0001-sota')

    // Notes is a string metric column; verify the SOTA submenu exists in its
    // context menu (metric columns get the display submenics).
    const notesHeader = container.querySelector<HTMLElement>(
      '[data-column-id="schema:notes"] button',
    )!
    fireEvent.contextMenu(notesHeader)
    const sotaSubTrigger = screen.getByRole('menuitem', { name: /SOTA highlight/i })
    expect(sotaSubTrigger).toBeInTheDocument()
    await user.click(sotaSubTrigger)
    // All three modes are valid options; "Off" is the default (not disabled).
    expect(screen.getByRole('menuitem', { name: /^Off$/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Higher is better/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Lower is better/i })).toBeInTheDocument()

    // String metric values never receive SOTA rank styling regardless of mode.
    const table = container.querySelector('table') ?? screen.getByRole('table')
    const v0001NotesCell = table.querySelector(
      '[data-variant-id="V0001"] [data-column-id="schema:notes"]',
    )
    expect(v0001NotesCell).not.toHaveClass('font-bold', 'underline')

    unmount()
  })
})

function renderResults(
  experimentId: string,
  document: ResultsDocument = RESULTS,
  variantEligibility?: ResultsVariantEligibility[],
) {
  const portalRoot = window.document.createElement('div')
  portalRoot.id = 'portal-root'
  window.document.body.appendChild(portalRoot)
  const result = render(
    <ExperimentResultsTable
      document={document}
      project="research"
      experimentId={experimentId}
      runIds={['run-a', 'run-b', 'run-c']}
      variantEligibility={variantEligibility}
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

function columnOptionIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-column-option]')).map(
    (option) => option.dataset.columnOption ?? '',
  )
}

function dragBefore(source: HTMLElement, target: HTMLElement) {
  const dataTransfer = {
    dropEffect: 'none',
    effectAllowed: 'none',
    setData: vi.fn(),
  }
  fireEvent.dragStart(source, { dataTransfer })
  fireEvent.dragOver(target, { clientX: 0, dataTransfer })
  fireEvent.drop(target, { clientX: 0, dataTransfer })
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
