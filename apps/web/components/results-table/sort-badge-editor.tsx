'use client'

import { Plus } from 'lucide-react'
import { useState } from 'react'
import { sortDirectionLabel, sortDirectionSymbol } from '../../lib/experiment-results/format'
import type { ResultTableColumn } from '../../lib/experiment-results/types'
import type {
  ResultsViewSortDirection,
  ResultsViewSortRule,
} from '../../lib/experiment-results/views'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

/**
 * A saved default-sort badge that opens its editor (column, direction,
 * priority moves), or (without `rule`) the trailing add-sort badge.
 */
export function SortBadgeEditor({
  rule,
  priority,
  columns,
  usedColumnIds,
  experimentId,
  canMoveEarlier = false,
  canMoveLater = false,
  onSave,
  onDelete,
  onMoveEarlier,
  onMoveLater,
}: {
  rule?: ResultsViewSortRule
  priority: number
  columns: ResultTableColumn[]
  usedColumnIds: ReadonlySet<string>
  experimentId: string
  canMoveEarlier?: boolean
  canMoveLater?: boolean
  onSave: (rule: Omit<ResultsViewSortRule, 'id'>) => void
  onDelete?: () => void
  onMoveEarlier?: () => void
  onMoveLater?: () => void
}) {
  const firstAvailableColumn = columns.find((column) => !usedColumnIds.has(column.id)) ?? columns[0]
  const [open, setOpen] = useState(false)
  const [columnId, setColumnId] = useState(rule?.columnId ?? firstAvailableColumn?.id ?? '')
  const [direction, setDirection] = useState<ResultsViewSortDirection>(rule?.direction ?? 'asc')
  const column = columns.find((candidate) => candidate.id === columnId) ?? firstAvailableColumn
  const columnLabel =
    columns.find((candidate) => candidate.id === rule?.columnId)?.label ?? rule?.columnId ?? 'Sort'
  const editorId = rule?.id ?? 'new'
  const allColumnsUsed =
    columns.length > 0 && columns.every((candidate) => usedColumnIds.has(candidate.id))

  const setEditorOpen = (nextOpen: boolean) => {
    if (nextOpen) {
      setColumnId(rule?.columnId ?? firstAvailableColumn?.id ?? '')
      setDirection(rule?.direction ?? 'asc')
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
          className={cn('h-6 rounded-full px-2', !rule && 'border-dashed text-muted-foreground')}
          disabled={!rule && allColumnsUsed}
          aria-label={
            rule
              ? `Edit sort ${priority} ${columnLabel} ${sortDirectionLabel(rule.direction)}`
              : 'Add default sort'
          }
          data-sort-rule={rule?.id}
        >
          {rule ? (
            <>
              <span className="text-[9px] text-muted-foreground">{priority}</span>
              <span>{columnLabel}</span>
              <span className="font-mono text-muted-foreground">
                {sortDirectionSymbol(rule.direction)}
              </span>
            </>
          ) : (
            <>
              <Plus aria-hidden />
              Sort
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (!column?.id) return
            onSave({ columnId: column.id, direction })
            setOpen(false)
          }}
        >
          <div>
            <div className="text-xs font-medium">
              {rule ? `Edit default sort · priority ${priority}` : 'Add default sort'}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Sort badges run from left to right, then Variant ID.
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`default-sort-column-${experimentId}-${editorId}`}>Column</Label>
            <Select value={column?.id ?? ''} onValueChange={setColumnId}>
              <SelectTrigger
                id={`default-sort-column-${experimentId}-${editorId}`}
                className="w-full"
                aria-label="Sort column"
              >
                <SelectValue placeholder="Column" />
              </SelectTrigger>
              <SelectContent>
                {columns.map((candidate) => (
                  <SelectItem
                    key={candidate.id}
                    value={candidate.id}
                    disabled={candidate.id !== rule?.columnId && usedColumnIds.has(candidate.id)}
                  >
                    {candidate.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`default-sort-direction-${experimentId}-${editorId}`}>Direction</Label>
            <Select
              value={direction}
              onValueChange={(next) => setDirection(next as ResultsViewSortDirection)}
            >
              <SelectTrigger
                id={`default-sort-direction-${experimentId}-${editorId}`}
                className="w-full"
                aria-label="Sort direction"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="asc">Small to large (ascending)</SelectItem>
                <SelectItem value="desc">Large to small (descending)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {rule && (
            <div className="flex gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canMoveEarlier}
                onClick={() => {
                  onMoveEarlier?.()
                  setOpen(false)
                }}
                aria-label={`Move ${columnLabel} sort earlier`}
              >
                Earlier
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canMoveLater}
                onClick={() => {
                  onMoveLater?.()
                  setOpen(false)
                }}
                aria-label={`Move ${columnLabel} sort later`}
              >
                Later
              </Button>
            </div>
          )}
          <div className="flex items-center justify-end gap-1.5">
            {rule && onDelete && (
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
              {rule ? 'Save changes' : 'Add sort'}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
