'use client'

import dynamic from 'next/dynamic'
import { useMemo, useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '../../../../components/ui/tabs'
import { cn } from '../../../utils'
import type { ComponentData, ComponentRenderer } from '../../types'
import type { descriptor } from './index'
import { buildPlotModel, buildScatterModel, cellLabel, distinctValues, filterRows } from './series'

type Datatable = ComponentData<typeof descriptor>
type View = Datatable['views'][number]
type TableView = Extract<View, { type: 'table' }>

const plotLoading = () => <div className="h-[220px]" aria-busy="true" />
const DatatablePlot = dynamic(() => import('./plot').then((module) => module.DatatablePlot), {
  ssr: false,
  loading: plotLoading,
})
const DatatableScatter = dynamic(() => import('./plot').then((module) => module.DatatableScatter), {
  ssr: false,
  loading: plotLoading,
})

export const Render: ComponentRenderer<Datatable> = ({ data, block }) => {
  const [active, setActive] = useState(0)
  const view = data.views[Math.min(active, data.views.length - 1)] as View

  return (
    <figure
      className="not-prose my-4 min-w-0 overflow-hidden rounded-md border bg-card text-card-foreground"
      data-component={`datatable@${block.version}`}
    >
      {data.views.length > 1 && (
        <div
          className="flex flex-wrap gap-1 border-b bg-muted/30 px-3 py-2"
          data-datatable-views=""
        >
          {data.views.map((candidate, index) => (
            <button
              // Views have no identity beyond their position in the payload.
              // biome-ignore lint/suspicious/noArrayIndexKey: display-only ordered list
              key={`${candidate.type}-${index}`}
              type="button"
              onClick={() => setActive(index)}
              data-datatable-view={candidate.type}
              data-active={index === active ? '' : undefined}
              className={cn(
                'rounded px-2 py-0.5 text-xs',
                index === active
                  ? 'bg-background font-medium text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {candidate.type}
            </button>
          ))}
        </div>
      )}

      {/* Keyed by position so each view starts from its own defaults. */}
      {view.type === 'table' ? (
        <DatatableTable key={active} data={data} view={view} />
      ) : (
        <DatatablePlotView key={active} data={data} view={view} />
      )}

      {(data.title || data.note) && (
        <figcaption className="space-y-1 border-t bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {data.title && (
            <div className="font-medium text-foreground" data-datatable-title="">
              {data.title}
            </div>
          )}
          {data.note && <p data-datatable-note="">{data.note}</p>}
        </figcaption>
      )}
    </figure>
  )
}

function chipClass(on: boolean) {
  return cn(
    'rounded-full border px-2.5 py-0.5 text-xs',
    on
      ? 'border-primary bg-primary text-primary-foreground'
      : 'bg-background text-muted-foreground hover:text-foreground',
  )
}

/**
 * Named filters are toggle chips: in `any` mode each chip toggles and the
 * active ones combine with AND; in `one` mode choosing a chip replaces the
 * active one and `All` clears it.
 */
function DatatableTable({ data, view }: { data: Datatable; view: TableView }) {
  const filters = view.filters ?? []
  const single = view.filter_mode === 'one'
  const [activeLabels, setActiveLabels] = useState<string[]>(() =>
    filters.filter((filter) => filter.default).map((filter) => filter.label),
  )
  const rows = useMemo(
    () =>
      filterRows(
        data.columns,
        data.data,
        filters.filter((filter) => activeLabels.includes(filter.label)),
      ),
    [data.columns, data.data, filters, activeLabels],
  )
  const toggle = (label: string) =>
    setActiveLabels((current) =>
      single
        ? [label]
        : current.includes(label)
          ? current.filter((candidate) => candidate !== label)
          : [...current, label],
    )

  return (
    <div className="min-w-0">
      {filters.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-1.5 border-b px-3 py-2"
          data-datatable-filters={single ? 'one' : 'any'}
        >
          {single && (
            <button
              type="button"
              aria-pressed={activeLabels.length === 0}
              onClick={() => setActiveLabels([])}
              data-datatable-filter-all=""
              className={chipClass(activeLabels.length === 0)}
            >
              All
            </button>
          )}
          {filters.map((filter) => {
            const on = activeLabels.includes(filter.label)
            return (
              <button
                key={filter.label}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(filter.label)}
                data-datatable-filter={filter.label}
                data-active={on ? '' : undefined}
                className={chipClass(on)}
              >
                {filter.label}
              </button>
            )
          })}
          <span
            className="ml-auto text-xs text-muted-foreground tabular-nums"
            data-datatable-rowcount={rows.length}
          >
            {rows.length} of {data.data.length} rows
          </span>
        </div>
      )}
      {rows.length === 0 && filters.length > 0 ? (
        <p className="px-3 py-6 text-center text-xs text-muted-foreground" role="status">
          No rows match the active filters.
        </p>
      ) : (
        <DatatableRows columns={data.columns} rows={rows} />
      )}
    </div>
  )
}

function DatatableRows({ columns, rows }: { columns: string[]; rows: unknown[][] }) {
  return (
    <div className="min-w-0 overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column} className="font-mono">
                {column}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, rowIndex) => (
            // Rows have no identity beyond their position in the payload.
            // biome-ignore lint/suspicious/noArrayIndexKey: display-only ordered list
            <TableRow key={`row-${rowIndex}`}>
              {row.map((cell, cellIndex) => (
                <TableCell
                  // Cells have no identity beyond their column position.
                  // biome-ignore lint/suspicious/noArrayIndexKey: display-only ordered list
                  key={`cell-${cellIndex}`}
                  className={cn('align-top', typeof cell === 'number' && 'font-mono tabular-nums')}
                >
                  {cell === null || cell === undefined ? '—' : cellLabel(cell)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/**
 * `tabs` is the outer filter and `select` the inner one: picking a tab resets
 * the dropdown to the first value that tab actually has, because the two
 * columns are orthogonal only in the payload, not in the data.
 */
function DatatablePlotView({ data, view }: { data: Datatable; view: Exclude<View, TableView> }) {
  const tabs = useMemo(
    () => distinctValues(data.columns, data.data, view.tabs),
    [data.columns, data.data, view.tabs],
  )
  const [tab, setTab] = useState(() => tabs[0])
  const activeTab = tab !== undefined && tabs.includes(tab) ? tab : tabs[0]
  const options = useMemo(
    () =>
      distinctValues(
        data.columns,
        data.data,
        view.select,
        view.tabs !== undefined && activeTab !== undefined
          ? { column: view.tabs, value: activeTab }
          : undefined,
      ),
    [data.columns, data.data, view.select, view.tabs, activeTab],
  )
  const [selected, setSelected] = useState(() => options[0])
  const activeOption = selected !== undefined && options.includes(selected) ? selected : options[0]
  const changeTab = (value: string) => {
    setTab(value)
    setSelected(
      distinctValues(
        data.columns,
        data.data,
        view.select,
        view.tabs === undefined ? undefined : { column: view.tabs, value },
      )[0],
    )
  }

  const model = useMemo(() => {
    const filter = { tab: activeTab, select: activeOption }
    return view.type === 'scatter'
      ? { kind: 'scatter' as const, ...buildScatterModel(data.columns, data.data, view, filter) }
      : { kind: 'plot' as const, ...buildPlotModel(data.columns, data.data, view, filter) }
  }, [data.columns, data.data, view, activeTab, activeOption])

  return (
    <div className="min-w-0 px-3 py-3" data-datatable-plot={view.type}>
      {tabs.length > 0 && (
        <Tabs value={activeTab} onValueChange={changeTab} className="mb-2">
          <TabsList data-datatable-tabs={view.tabs}>
            {tabs.map((value) => (
              <TabsTrigger key={value} value={value}>
                {value}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}
      {options.length > 0 && (
        <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">{view.select}</span>
          <Select value={activeOption} onValueChange={setSelected}>
            <SelectTrigger
              className="h-7 w-auto min-w-[8rem] text-xs"
              data-datatable-select={view.select}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((value) => (
                <SelectItem key={value} value={value} className="text-xs">
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div data-datatable-series={model.series.join(',')}>
        {model.points.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground" role="status">
            No numeric rows to plot.
          </p>
        ) : model.kind === 'scatter' ? (
          <DatatableScatter view={view} model={model} />
        ) : (
          <DatatablePlot view={view} model={model} />
        )}
      </div>
      {model.skipped > 0 && (
        <p className="mt-1 text-xs text-muted-foreground" data-datatable-skipped={model.skipped}>
          {`${model.skipped} ${model.skipped === 1 ? 'row' : 'rows'} skipped (non-numeric ${model.kind === 'scatter' ? 'x or y' : 'y'})`}
        </p>
      )}
    </div>
  )
}
