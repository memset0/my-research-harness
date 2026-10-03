'use client'

// The first header row: one cell per run of adjacent unpinned columns of the
// same first-level group (labelled, collapsible), blank over columns without
// one; and the narrow placeholder of a collapsed group in the second row.

import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { BandCell } from '../../lib/experiment-results/tree'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { TableHead } from '../ui/table'

export function GroupHeader({
  cell,
  canCollapse,
  onToggleCollapsed,
}: {
  cell: BandCell
  canCollapse: boolean
  onToggleCollapsed: (groupId: string) => void
}) {
  if (!cell.band) {
    return <TableHead colSpan={cell.span} className="h-7 border-r last:border-r-0" aria-hidden />
  }
  const { band } = cell
  return (
    <TableHead
      colSpan={cell.span}
      className={cn(
        'h-7 border-r px-1.5 text-[11px] font-semibold text-muted-foreground last:border-r-0',
        cell.collapsed && 'bg-muted/60',
      )}
      data-group-id={band.id}
      data-group-collapsed={cell.collapsed || undefined}
    >
      <span className="flex items-center gap-1">
        <span className="truncate" data-group-label>
          {band.label}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={!canCollapse}
          onClick={() => onToggleCollapsed(band.id)}
          aria-label={`${cell.collapsed ? 'Expand' : 'Collapse'} ${band.label} group`}
          aria-expanded={!cell.collapsed}
        >
          {cell.collapsed ? <ChevronRight aria-hidden /> : <ChevronLeft aria-hidden />}
        </Button>
      </span>
    </TableHead>
  )
}

/** The second-row placeholder of a collapsed group: its visible column count. */
export function CollapsedHeader({
  groupId,
  label,
  visibleCount,
}: {
  groupId: string
  label: string
  visibleCount: number
}) {
  return (
    <TableHead
      className="h-8 w-14 border-r px-1.5 text-center text-[10px] font-normal text-muted-foreground last:border-r-0"
      data-collapsed-group={groupId}
      title={`${label}: ${visibleCount} visible ${visibleCount === 1 ? 'column' : 'columns'} collapsed`}
    >
      {visibleCount} {visibleCount === 1 ? 'col' : 'cols'}
    </TableHead>
  )
}
