'use client'

import { Columns3, Eye, RotateCcw } from 'lucide-react'
import { useRef, useState } from 'react'
import { cn } from '../../lib/utils'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../ui/dialog'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Toggle } from '../ui/toggle'
import { lockedGroupProps } from './locked-group'

/**
 * Column summary, temporary show-all, maximum lines per cell, and the Reset
 * view action guarded by a destructive confirmation dialog.
 */
export function ColumnToolbar({
  experimentId,
  locked,
  visibleCount,
  totalCount,
  hiddenCount,
  showAllColumns,
  onShowAllColumnsChange,
  maxLines,
  onMaxLinesChange,
  resetDisabled,
  onReset,
}: {
  experimentId: string
  locked: boolean
  visibleCount: number
  totalCount: number
  hiddenCount: number
  showAllColumns: boolean
  onShowAllColumnsChange: (value: boolean) => void
  maxLines: number
  onMaxLinesChange: (value: number) => void
  resetDisabled: boolean
  onReset: () => void
}) {
  const [resetOpen, setResetOpen] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const lockedProps = lockedGroupProps(locked)
  return (
    <div
      {...lockedProps}
      className={cn('flex flex-wrap items-center gap-2', lockedProps.className)}
    >
      <div className="flex items-center gap-1.5 text-xs font-medium">
        <Columns3 className="size-3.5 text-muted-foreground" aria-hidden />
        Columns
      </div>
      <Badge variant="secondary" className="tabular-nums">
        {visibleCount}/{totalCount} shown
      </Badge>
      {showAllColumns && hiddenCount > 0 && (
        <Badge variant="outline">{hiddenCount} saved hidden · paused</Badge>
      )}
      <Toggle
        variant="outline"
        size="sm"
        pressed={showAllColumns}
        onPressedChange={onShowAllColumnsChange}
        aria-label={showAllColumns ? 'Resume saved column filters' : 'Show all columns temporarily'}
      >
        <Eye data-icon="inline-start" />
        {showAllColumns ? 'Resume column filters' : 'Show all temporarily'}
      </Toggle>
      <div className="ml-auto flex items-center gap-2">
        <Label htmlFor={`results-max-lines-${experimentId}`} className="text-muted-foreground">
          Max lines
        </Label>
        <Input
          id={`results-max-lines-${experimentId}`}
          type="number"
          min={1}
          step={1}
          value={maxLines}
          onChange={(event) => onMaxLinesChange(Number(event.target.value))}
          className="w-16 tabular-nums"
          aria-label="Maximum lines per results cell"
        />
        <Dialog open={resetOpen} onOpenChange={setResetOpen}>
          <DialogTrigger asChild>
            <Button type="button" variant="ghost" size="sm" disabled={resetDisabled}>
              <RotateCcw data-icon="inline-start" />
              Reset view
            </Button>
          </DialogTrigger>
          <DialogContent
            onOpenAutoFocus={(event) => {
              event.preventDefault()
              cancelRef.current?.focus()
            }}
          >
            <DialogHeader>
              <DialogTitle>Reset Results view?</DialogTitle>
              <DialogDescription>
                This clears your saved default sort, row filters, checkbox visibility, column order,
                pinned columns, row overrides, maximum line count, and temporary view and sort
                controls. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button ref={cancelRef} type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                type="button"
                variant="destructive"
                aria-label="Confirm reset Results view"
                onClick={() => {
                  onReset()
                  setResetOpen(false)
                }}
              >
                <RotateCcw data-icon="inline-start" />
                Reset view
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
