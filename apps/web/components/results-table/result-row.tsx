'use client'

import type { ResultsVariantEligibility, ResultVariant } from '@memon/core'
import { Ban, CircleCheck, X } from 'lucide-react'
import type { ProjectTarget } from '../../lib/api'
import { resultValueDescription } from '../../lib/experiment-results/columns'
import { plainCellValue } from '../../lib/experiment-results/format'
import { pinnedColumnStyle, pinnedOpaqueBackground } from '../../lib/experiment-results/layout'
import type { PinLayout, ResultTableColumn, SotaRanking } from '../../lib/experiment-results/types'
import type { ResultsViewPinSide, ResultsViewRowOverride } from '../../lib/experiment-results/views'
import { cn } from '../../lib/utils'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../ui/context-menu'
import { TableCell, TableRow } from '../ui/table'
import { AnnotationTooltip } from './annotation-tooltip'
import { CellClamp, ResultCell } from './cells'

/** Table-wide inputs every body cell needs. */
export interface ResultCellContext {
  project: ProjectTarget
  experimentId: string
  declaredRunIds: ReadonlySet<string>
  maxLines: number
  starredLabels: ReadonlySet<string>
  pinnedColumnSide: ReadonlyMap<string, ResultsViewPinSide>
  pinLayout: PinLayout
  sotaRanks: ReadonlyMap<string, SotaRanking>
  decimalPlaces: Readonly<Record<string, number>>
}

/** One Variant row; its context menu sets or clears the row override. */
export function ResultRow({
  variant,
  columns,
  context,
  eligibility,
  rowOverride,
  canMutate,
  onSetRowOverride,
}: {
  variant: ResultVariant
  columns: ResultTableColumn[]
  context: ResultCellContext
  eligibility: ResultsVariantEligibility | undefined
  rowOverride: ResultsViewRowOverride | undefined
  canMutate: boolean
  onSetRowOverride: (variantId: string, override: ResultsViewRowOverride | null) => void
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <TableRow
          className={cn(
            rowOverride === 'include' && 'bg-emerald-50/50 dark:bg-emerald-950/15',
            rowOverride === 'exclude' && 'bg-red-50/50 dark:bg-red-950/15',
          )}
          data-variant-id={variant.id}
          data-row-override={rowOverride}
        >
          {columns.map((column) => (
            <ResultTableCell
              key={column.id}
              column={column}
              variant={variant}
              context={context}
              eligibility={eligibility}
            />
          ))}
        </TableRow>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuLabel className="truncate">
          {variant.id} · {variant.name}
        </ContextMenuLabel>
        <ContextMenuItem
          disabled={!canMutate || rowOverride === 'include'}
          onSelect={() => onSetRowOverride(variant.id, 'include')}
        >
          <CircleCheck />
          {rowOverride === 'include' ? 'Forced shown' : 'Force show row'}
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!canMutate || rowOverride === 'exclude'}
          onSelect={() => onSetRowOverride(variant.id, 'exclude')}
        >
          <Ban />
          {rowOverride === 'exclude' ? 'Forced hidden' : 'Force hide row'}
        </ContextMenuItem>
        {rowOverride && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              disabled={!canMutate}
              onSelect={() => onSetRowOverride(variant.id, null)}
            >
              <X />
              Clear row override
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

function ResultTableCell({
  column,
  variant,
  context,
  eligibility,
}: {
  column: ResultTableColumn
  variant: ResultVariant
  context: ResultCellContext
  eligibility: ResultsVariantEligibility | undefined
}) {
  const starred = context.starredLabels.has(column.label)
  const metric = column.schema?.group === 'metric'
  const pinSide = context.pinnedColumnSide.get(column.id)
  const pinSticky = Boolean(pinSide && context.pinLayout.sticky)
  const valueDescription = resultValueDescription(column, variant)
  return (
    <TableCell
      className={cn(
        'min-w-24 max-w-[32rem] border-r px-2.5 py-2 align-top last:border-r-0',
        column.kind === 'variant' && 'min-w-52',
        pinSticky && 'sticky z-10',
        metric && 'bg-sky-50/40 dark:bg-sky-950/15',
        starred && 'bg-amber-50/50 dark:bg-amber-950/20',
        pinSticky && pinnedOpaqueBackground(metric, starred, 'cell'),
      )}
      style={pinnedColumnStyle(column.id, pinSide, context.pinLayout)}
      data-column-id={column.id}
      data-column-group={column.schema?.group}
      data-pinned={pinSide}
      data-pin-sticky={pinSticky || undefined}
    >
      <AnnotationTooltip description={valueDescription} label={`${column.label} value description`}>
        <CellClamp
          maxLines={context.maxLines}
          title={valueDescription === undefined ? plainCellValue(column, variant) : undefined}
          focusable={valueDescription !== undefined}
        >
          <ResultCell
            column={column}
            variant={variant}
            project={context.project}
            experimentId={context.experimentId}
            declaredRunIds={context.declaredRunIds}
            eligibility={eligibility}
            sotaRank={metric ? context.sotaRanks.get(column.id)?.ranks.get(variant.id) : undefined}
            decimalPlaces={metric ? context.decimalPlaces[column.id] : undefined}
          />
        </CellClamp>
      </AnnotationTooltip>
    </TableCell>
  )
}
