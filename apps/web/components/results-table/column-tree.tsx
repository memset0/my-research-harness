'use client'

// The vertical column tree of the Results controls: partitions, groups and
// one leaf per declared or undeclared column, top to bottom in tree order,
// with tri-state checkboxes (a node's check applies to every descendant),
// collapsible nodes, distinct-value counts, the pale-blue metric treatment,
// per-column pinning and stars. Rows reorder by vertical drag inside their
// own parent only; the pinned section at the top orders the pinned zone.

import { ChevronDown, ChevronRight, GripVertical, Pin, PinOff, Star } from 'lucide-react'
import { useState } from 'react'
import type { ColumnTree, ColumnTreeNode } from '../../lib/experiment-results/tree'
import { PINNED_SCOPE } from '../../lib/experiment-results/tree'
import { cn } from '../../lib/utils'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '../ui/hover-card'
import { renderTextWithBreaks } from './cells'
import { lockedGroupProps } from './locked-group'
import { type TriState, TriStateCheckbox } from './tri-state-checkbox'
import type { DragHandlers } from './use-drag-reorder'

export interface ColumnTreeProps {
  experimentId: string
  locked: boolean
  tree: ColumnTree
  checkState: (node: ColumnTreeNode) => TriState
  domains: ReadonlyMap<string, string[]>
  starredLabels: ReadonlySet<string>
  /** Pinned column ids in pinned-zone order, with their breadcrumb labels. */
  pinned: ReadonlyArray<{ id: string; label: string }>
  drag: DragHandlers
  onSetVisible: (nodeId: string, visible: boolean) => void
  onSetPinned: (columnId: string, pinned: boolean) => void
  onToggleStar: (label: string) => void
}

export function ColumnTreeControls(props: ColumnTreeProps) {
  const { tree, locked, pinned } = props
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set())
  const lockedProps = lockedGroupProps(locked)
  const toggleFold = (id: string) =>
    setFolded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  return (
    <div
      {...lockedProps}
      className={cn('flex flex-col gap-2', lockedProps.className)}
      data-slot="results-column-tree"
    >
      {pinned.length > 0 && (
        <section
          className="rounded-md border border-dashed bg-card/60 p-1.5"
          data-slot="results-column-tree-pinned"
          aria-label="Pinned columns"
        >
          <h4 className="flex items-center gap-1 px-1 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <Pin className="size-3" aria-hidden />
            Pinned
          </h4>
          <ol className="flex flex-col gap-0.5">
            {pinned.map((entry, index) => {
              const dragItem = { kind: 'pinned', id: entry.id, scope: PINNED_SCOPE } as const
              return (
                <li
                  key={entry.id}
                  {...props.drag.bind(dragItem, { vertical: true })}
                  className={cn(
                    'flex h-7 cursor-grab items-center gap-1.5 rounded-sm px-1 text-xs hover:bg-muted/60 active:cursor-grabbing',
                    props.drag.isDragged(dragItem) && 'opacity-50',
                    props.drag.isDropTarget(dragItem) && 'ring-2 ring-primary/60',
                  )}
                  data-pinned-option={entry.id}
                  title={`Drag to reorder pinned column ${index + 1}`}
                >
                  <GripVertical className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => props.onSetPinned(entry.id, false)}
                    aria-label={`Unpin ${entry.label}`}
                  >
                    <PinOff aria-hidden />
                  </Button>
                </li>
              )
            })}
          </ol>
        </section>
      )}
      <ul
        aria-label="Results columns"
        className="max-h-96 overflow-y-auto rounded-md border bg-card/60 p-1"
        data-slot="results-column-tree-nodes"
      >
        {tree.roots.map((node) => (
          <TreeRows
            key={node.id}
            node={node}
            folded={folded}
            onToggleFold={toggleFold}
            {...props}
          />
        ))}
      </ul>
    </div>
  )
}

function TreeRows({
  node,
  folded,
  onToggleFold,
  ...props
}: ColumnTreeProps & {
  node: ColumnTreeNode
  folded: ReadonlySet<string>
  onToggleFold: (id: string) => void
}) {
  const expanded = !folded.has(node.id)
  return (
    <li data-depth={node.depth}>
      {node.column ? (
        <LeafRow node={node} {...props} />
      ) : (
        <GroupRow node={node} expanded={expanded} onToggleFold={onToggleFold} {...props} />
      )}
      {!node.column && expanded && node.children.length > 0 && (
        <ul className="ml-3 border-l pl-1">
          {node.children.map((child) => (
            <TreeRows
              key={child.id}
              node={child}
              folded={folded}
              onToggleFold={onToggleFold}
              {...props}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function GroupRow({
  node,
  expanded,
  onToggleFold,
  drag,
  checkState,
  experimentId,
  onSetVisible,
}: ColumnTreeProps & {
  node: ColumnTreeNode
  expanded: boolean
  onToggleFold: (id: string) => void
}) {
  const dragItem = { kind: 'tree-node', id: node.id, scope: node.parentId } as const
  const state = checkState(node)
  const metric = node.id === 'group:metrics' || node.id.startsWith('group:metrics.')
  return (
    <div
      {...drag.bind(dragItem, { vertical: true })}
      className={cn(
        'flex h-7 cursor-grab items-center gap-1 rounded-sm pr-1 text-xs active:cursor-grabbing hover:bg-muted/60',
        drag.isDragged(dragItem) && 'opacity-50',
        drag.isDropTarget(dragItem) && 'ring-2 ring-primary/60',
      )}
      data-tree-node={node.id}
      data-tree-kind={node.kind}
      data-column-group={metric ? 'metric' : undefined}
      title={`Drag ${node.label} to reorder within its group`}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={() => onToggleFold(node.id)}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.label} in the column tree`}
        aria-expanded={expanded}
      >
        {expanded ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
      </Button>
      <TriStateCheckbox
        id={`results-node-${experimentId}-${node.id}`}
        checked={state}
        onCheckedChange={(checked) => onSetVisible(node.id, checked === true)}
        aria-label={`Show ${node.label} ${node.kind === 'partition' ? 'partition' : 'group'}`}
      />
      <span className={cn('truncate', node.kind === 'partition' ? 'font-semibold' : 'font-medium')}>
        {node.label}
      </span>
      <Badge variant="outline" className="ml-auto h-4 px-1.5 text-[9px] tabular-nums">
        {node.leafIds.length}
      </Badge>
    </div>
  )
}

function LeafRow({
  node,
  drag,
  checkState,
  experimentId,
  domains,
  starredLabels,
  pinned,
  onSetVisible,
  onSetPinned,
  onToggleStar,
}: ColumnTreeProps & { node: ColumnTreeNode }) {
  const column = node.column!
  const dragItem = { kind: 'tree-node', id: node.id, scope: node.parentId } as const
  const values = domains.get(column.id) ?? []
  const starred = starredLabels.has(column.label)
  const isPinned = pinned.some((entry) => entry.id === column.id)
  const summary = (
    <>
      <span className="truncate" data-column-label>
        {column.label}
      </span>
      {!column.result?.declared && column.kind === 'result' && (
        <span
          className="text-[9px] text-muted-foreground"
          title="Recorded but not declared in experiment.json"
        >
          undeclared
        </span>
      )}
      <Badge variant="outline" className="h-4 shrink-0 px-1.5 text-[9px] tabular-nums">
        {values.length}
      </Badge>
    </>
  )
  return (
    <div
      {...drag.bind(dragItem, { vertical: true })}
      className={cn(
        'flex h-7 min-w-0 cursor-grab items-center gap-1 rounded-sm border border-transparent pr-0.5 pl-6 text-xs active:cursor-grabbing hover:bg-muted/60',
        column.metric && 'border-sky-200 bg-sky-50/60 dark:border-sky-900 dark:bg-sky-950/20',
        starred && 'border-amber-300 bg-amber-50/70 dark:border-amber-700/60 dark:bg-amber-950/30',
        drag.isDragged(dragItem) && 'opacity-50',
        drag.isDropTarget(dragItem) && 'ring-2 ring-primary/60',
      )}
      data-tree-node={node.id}
      data-tree-kind="column"
      data-column-option={column.id}
      data-column-group={
        column.metric ? 'metric' : column.kind === 'result' ? 'parameter' : undefined
      }
      title={`Drag ${column.label} to reorder within its group`}
    >
      <TriStateCheckbox
        id={`results-column-${experimentId}-${column.id}`}
        checked={checkState(node)}
        onCheckedChange={(checked) => onSetVisible(node.id, checked === true)}
        aria-label={`Show ${column.label} column`}
      />
      {column.metric ? (
        <span className="flex min-w-0 items-center gap-1 px-1">{summary}</span>
      ) : (
        <HoverCard openDelay={250} closeDelay={100}>
          <HoverCardTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 min-w-0 gap-1 px-1"
              aria-label={`Inspect distinct values for ${column.label}`}
            >
              {summary}
            </Button>
          </HoverCardTrigger>
          <HoverCardContent align="start" className="w-72 p-3">
            <div className="mb-2 text-xs font-medium">
              {column.label} · {values.length} distinct {values.length === 1 ? 'value' : 'values'}
            </div>
            {values.length === 0 ? (
              <div className="text-xs italic text-muted-foreground">No values</div>
            ) : (
              <ul className="max-h-64 space-y-1 overflow-y-auto text-xs">
                {values.map((value) => (
                  <li key={value} className="break-all rounded bg-muted px-2 py-1 font-mono">
                    {renderTextWithBreaks(value)}
                  </li>
                ))}
              </ul>
            )}
          </HoverCardContent>
        </HoverCard>
      )}
      <span className="ml-auto flex shrink-0 items-center">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => onSetPinned(column.id, !isPinned)}
          aria-label={`${isPinned ? 'Unpin' : 'Pin'} ${column.label} column`}
          aria-pressed={isPinned}
          data-pin-indicator={isPinned || undefined}
          className={cn(isPinned && 'text-primary')}
        >
          {isPinned ? <Pin className="fill-current" aria-hidden /> : <Pin aria-hidden />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => onToggleStar(column.label)}
          aria-label={`${starred ? 'Unstar' : 'Star'} ${column.label} column`}
          aria-pressed={starred}
          className={cn(starred && 'text-amber-600 hover:text-amber-700 dark:text-amber-300')}
        >
          <Star className={cn(starred && 'fill-current')} aria-hidden />
        </Button>
      </span>
    </div>
  )
}
