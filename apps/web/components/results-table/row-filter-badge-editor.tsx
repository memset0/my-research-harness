'use client'

import { Filter, Plus } from 'lucide-react'
import { useState } from 'react'
import { operatorSymbol } from '../../lib/experiment-results/format'
import type { ResultTableColumn } from '../../lib/experiment-results/types'
import type {
  ResultsViewRowFilter,
  ResultsViewRowFilterOperator,
} from '../../lib/experiment-results/views'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

/**
 * A saved row-filter badge that opens its editor, or (without `filter`) the
 * trailing add-filter badge.
 */
export function RowFilterBadgeEditor({
  filter,
  priority,
  columns,
  domains,
  experimentId,
  paused,
  onSave,
  onDelete,
}: {
  filter?: ResultsViewRowFilter
  priority?: number
  columns: ResultTableColumn[]
  domains: ReadonlyMap<string, string[]>
  experimentId: string
  paused: boolean
  onSave: (filter: Omit<ResultsViewRowFilter, 'id'>) => void
  onDelete?: () => void
}) {
  const defaultColumnId = filter?.columnId ?? columns[0]?.id ?? ''
  const [open, setOpen] = useState(false)
  const [columnId, setColumnId] = useState(defaultColumnId)
  const [operator, setOperator] = useState<ResultsViewRowFilterOperator>(filter?.operator ?? 'eq')
  const [value, setValue] = useState(filter?.value ?? '')
  const column = columns.find((candidate) => candidate.id === columnId) ?? columns[0]
  const columnLabel =
    columns.find((candidate) => candidate.id === filter?.columnId)?.label ??
    filter?.columnId ??
    'Filter'
  const editorId = filter?.id ?? 'new'

  const setEditorOpen = (nextOpen: boolean) => {
    if (nextOpen) {
      setColumnId(filter?.columnId ?? columns[0]?.id ?? '')
      setOperator(filter?.operator ?? 'eq')
      setValue(filter?.value ?? '')
    }
    setOpen(nextOpen)
  }

  return (
    <Popover open={open} onOpenChange={setEditorOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            'h-6 rounded-full px-2',
            !filter && 'border-dashed text-muted-foreground',
            paused && 'opacity-60',
          )}
          aria-label={
            filter
              ? `Edit filter ${priority ?? ''} ${columnLabel} ${operatorSymbol(filter.operator)} ${filter.value || 'empty'}`.replace(
                  /\s+/g,
                  ' ',
                )
              : 'Add row filter'
          }
          data-row-filter={filter?.id}
        >
          {filter ? <Filter aria-hidden /> : <Plus aria-hidden />}
          {filter ? (
            <>
              <span className="text-[9px] text-muted-foreground">{priority}</span>
              <span>{columnLabel}</span>
              <span className="font-mono text-muted-foreground">
                {operatorSymbol(filter.operator)} {filter.value || '(empty)'}
              </span>
            </>
          ) : (
            'Filter'
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (!column?.id) return
            onSave({ columnId: column.id, operator, value })
            setOpen(false)
          }}
        >
          <div>
            <div className="text-xs font-medium">
              {filter ? `Edit row filter · priority ${priority}` : 'Add row filter'}
            </div>
            <p className="text-[10px] text-muted-foreground">All filter badges combine with AND.</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`row-filter-column-${experimentId}-${editorId}`}>Column</Label>
            <Select value={column?.id ?? ''} onValueChange={setColumnId}>
              <SelectTrigger
                id={`row-filter-column-${experimentId}-${editorId}`}
                className="w-full"
                aria-label="Filter column"
              >
                <SelectValue placeholder="Column" />
              </SelectTrigger>
              <SelectContent>
                {columns.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {candidate.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-2">
            <div className="space-y-1">
              <Label htmlFor={`row-filter-operator-${experimentId}-${editorId}`}>Match</Label>
              <Select
                value={operator}
                onValueChange={(next) => setOperator(next as ResultsViewRowFilterOperator)}
              >
                <SelectTrigger
                  id={`row-filter-operator-${experimentId}-${editorId}`}
                  className="w-full"
                  aria-label="Filter operator"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="eq">Equals (=)</SelectItem>
                  <SelectItem value="neq">Does not equal (≠)</SelectItem>
                  <SelectItem value="gt">Greater than (&gt;)</SelectItem>
                  <SelectItem value="lt">Less than (&lt;)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`row-filter-value-${experimentId}-${editorId}`}>Value</Label>
              <Input
                id={`row-filter-value-${experimentId}-${editorId}`}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                type={numericColumn(column) ? 'number' : 'text'}
                step={numericColumn(column) ? 'any' : undefined}
                inputMode={numericColumn(column) ? 'decimal' : undefined}
                list={`row-filter-values-${experimentId}-${editorId}`}
                placeholder="Empty matches empty"
                aria-label="Filter value"
              />
              <datalist id={`row-filter-values-${experimentId}-${editorId}`}>
                {(domains.get(column?.id ?? '') ?? []).map((domainValue) => (
                  <option key={domainValue} value={domainValue} />
                ))}
              </datalist>
            </div>
          </div>
          <div className="flex items-center justify-end gap-1.5">
            {filter && onDelete && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="mr-auto"
                onClick={() => {
                  onDelete()
                  setOpen(false)
                }}
              >
                Delete
              </Button>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!column?.id}>
              {filter ? 'Save changes' : 'Add filter'}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}

/** Numbers and stats columns (a stats filter compares its selected statistic). */
function numericColumn(column: ResultTableColumn | undefined): boolean {
  return column?.result?.type === 'number' || (column?.statOptions.length ?? 0) > 0
}
