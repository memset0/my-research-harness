'use client'

import { ChartSpline, CircleAlert, Layers, Snowflake, Split } from 'lucide-react'
import Link from 'next/link'
import { type ComponentProps, Fragment, type ReactNode } from 'react'
import { type ProjectTarget, projectWebPath } from '../../lib/api'
import type { ResultsCellPayload } from '../../lib/dto/experiments'
import { resultValueText } from '../../lib/experiment-results/columns'
import {
  gitBlobUrl,
  gitCommitUrl,
  keyedLines,
  parseWandbUrl,
  sotaRankClass,
} from '../../lib/experiment-results/format'
import { compareStatKeys, formatResultNumber } from '../../lib/experiment-results/stats'
import type { ResultTableColumn, ResultVariant, SotaRank } from '../../lib/experiment-results/types'
import { cn } from '../../lib/utils'
import { TranslatedLiteral } from '../body-translation'
import { Badge } from '../ui/badge'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '../ui/hover-card'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import { VariantStatusBadge } from '../variant-status-badge'

export interface ResultCellProps {
  column: ResultTableColumn
  variant: ResultVariant
  project: ProjectTarget
  experimentId: string
  /** Run paths declared by the Experiment; only these link into Run panels. */
  declaredRunIds: ReadonlySet<string>
  sotaRank?: SotaRank
}

/** Dispatches to the renderer for the column's value kind. */
export function ResultCell(props: ResultCellProps) {
  const { column } = props
  if (column.kind === 'variant') return <VariantCell {...props} />
  if (column.kind === 'status') return <StatusCell variant={props.variant} />
  if (column.kind === 'runs') return <RunListCell {...props} />
  if (column.kind === 'attempts') return <OtherRunsCell {...props} />
  if (column.kind === 'result') return <ResultValueCell {...props} />
  return <ProvenanceCell {...props} />
}

function VariantCell({ variant }: ResultCellProps) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="font-mono text-[10px] font-medium text-muted-foreground">{variant.id}</span>
      <span className="font-medium text-foreground">
        <TranslatedLiteral original={renderTextWithBreaks(variant.name)}>
          {variant.name}
        </TranslatedLiteral>
      </span>
    </span>
  )
}

/** The effective status; a declared plan state that the Runs overrode is flagged. */
export function StatusCell({
  variant,
}: {
  variant: Pick<ResultVariant, 'status' | 'declaredStatus'>
}) {
  const stale =
    variant.declaredStatus !== null &&
    variant.declaredStatus !== variant.status &&
    (variant.declaredStatus === 'PLANNED' || variant.declaredStatus === 'BLOCKED')
  return (
    <span className="inline-flex items-center gap-1">
      <VariantStatusBadge status={variant.status} />
      {stale && (
        <span
          className="inline-flex items-center gap-0.5 text-[10px] text-amber-700 dark:text-amber-300"
          title={`VARIANT_STATUS_STALE: declared ${variant.declaredStatus}; its Runs make it ${variant.status}`}
          data-status-stale
        >
          <CircleAlert className="size-3" aria-hidden />
          <span>declared {variant.declaredStatus}</span>
        </span>
      )}
    </span>
  )
}

function runHref(project: ProjectTarget, experimentId: string, run: string): string {
  return `${projectWebPath(project, `/e/${encodeURIComponent(experimentId)}`)}?run=${encodeURIComponent(run)}`
}

function RunLink({
  run,
  project,
  experimentId,
  declaredRunIds,
}: Pick<ResultCellProps, 'project' | 'experimentId' | 'declaredRunIds'> & { run: string }) {
  // A declared member links into the Experiment page's Run panel; a path the
  // Experiment does not declare stays plain text.
  return declaredRunIds.has(run) ? (
    <Link
      href={runHref(project, experimentId, run)}
      className="text-primary underline-offset-2 hover:underline"
    >
      {run}
    </Link>
  ) : (
    <code>{run}</code>
  )
}

function RunListCell({ variant, ...props }: ResultCellProps) {
  if (variant.evidence.length === 0) return <EmptyValue />
  return (
    <div className="space-y-0.5">
      {variant.evidence.map((run) => (
        <span key={run} className="block whitespace-nowrap font-mono text-[10px]">
          <RunLink run={run} {...props} />
        </span>
      ))}
    </div>
  )
}

function OtherRunsCell({ variant, ...props }: ResultCellProps) {
  if (variant.others.length === 0) return <EmptyValue />
  return (
    <div className="space-y-0.5">
      {variant.others.map((other) => (
        <span
          key={other.run}
          className="flex items-center gap-1 whitespace-nowrap font-mono text-[10px]"
          title={other.stopReason ? `stop reason: ${other.stopReason}` : undefined}
        >
          <RunLink run={other.run} {...props} />
          <span className="text-muted-foreground">{other.status}</span>
          {other.deprecated && <span className="text-muted-foreground">(deprecated)</span>}
          {other.missing && <span className="text-destructive">(missing)</span>}
        </span>
      ))}
    </div>
  )
}

function ProvenanceCell({ column, variant }: ResultCellProps) {
  const text = column.getText(variant)
  if (text === '') return <EmptyValue />
  const href =
    column.kind === 'entry' || column.kind === 'recipe'
      ? gitBlobUrl(variant, text)
      : column.kind === 'commit'
        ? gitCommitUrl(variant)
        : null
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="font-mono text-[10px] text-primary underline-offset-2 hover:underline"
      >
        {renderTextWithBreaks(text)}
      </a>
    )
  }
  return <code className="font-mono text-[10px]">{renderTextWithBreaks(text)}</code>
}

/** Markers of a summary cell: frozen, mixed, per Run, differs from plan, planned. */
function CellMarkers({ cell, column }: { cell: ResultsCellPayload; column: ResultTableColumn }) {
  return (
    <>
      {cell.source === 'frozen' && (
        <span
          className="inline-flex text-sky-700 dark:text-sky-300"
          title="Frozen historical value (recorded before FS v9, no Run directory carries it)"
          data-cell-marker="frozen"
        >
          <Snowflake className="size-3" aria-hidden />
          <span className="sr-only">frozen</span>
        </span>
      )}
      {cell.kind === 'mixed' && (
        <Badge variant="outline" className="h-4 px-1 text-[9px]" data-cell-marker="mixed">
          <Split aria-hidden />
          mixed
        </Badge>
      )}
      {cell.kind === 'per_run' && (
        <Badge variant="outline" className="h-4 px-1 text-[9px]" data-cell-marker="per-run">
          <Layers aria-hidden />
          per run
        </Badge>
      )}
      {cell.differsFromPlan && (
        <span
          className="inline-flex text-amber-700 dark:text-amber-300"
          title={`Differs from the planned value ${resultValueText(cell.planned, column.result) || '—'}`}
          data-cell-marker="differs-from-plan"
        >
          <CircleAlert className="size-3" aria-hidden />
          <span className="sr-only">
            differs from the planned {resultValueText(cell.planned, column.result) || '—'}
          </span>
        </span>
      )}
    </>
  )
}

/** Every statistic of a stats cell, its dimensions and contributing Runs. */
/**
 * One statistic of the hover detail in the column's number format; a count
 * (`n`, or the number of Runs `<stat>.n`) always reads as a plain number.
 */
function statValueText(key: string, value: number, result: ResultTableColumn['result']): string {
  if (key === 'n' || key.endsWith('.n')) return formatResultNumber(value)
  return formatResultNumber(value, {
    decimals: result?.decimals ?? null,
    format: result?.format ?? null,
  })
}

function StatsDetails({
  cell,
  column,
}: {
  cell: Extract<ResultsCellPayload, { kind: 'stats' }>
  column: ResultTableColumn
}) {
  const result = column.result
  const aggregated = cell.over === 'run' && cell.source === 'runs'
  const keys = Object.keys(cell.values).sort(compareStatKeys)
  return (
    <div className="space-y-1.5" data-slot="results-stats-details">
      <div className="text-[10px] text-muted-foreground">
        {aggregated
          ? `Across ${cell.runs?.length ?? 0} evidence Runs`
          : cell.source === 'frozen'
            ? 'Frozen historical statistics'
            : 'Recorded by one Run'}
        {cell.across ? ` · across ${cell.across}` : ''}
        {cell.over && cell.over !== 'run' ? ` · over ${cell.over}` : ''}
        {result?.unit ? ` · ${result.unit}` : ''}
      </div>
      <table className="w-full text-[11px]">
        <tbody>
          {keys.map((key) => {
            const value = cell.values[key]
            return (
              <tr key={key}>
                <th
                  scope="row"
                  className="pr-3 text-left font-mono font-normal text-muted-foreground"
                >
                  {key}
                </th>
                <td className="text-right font-mono tabular-nums">
                  {typeof value === 'number' ? statValueText(key, value, result) : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {cell.runs && cell.runs.length > 0 && (
        <ul className="space-y-0.5 font-mono text-[10px] text-muted-foreground">
          {cell.runs.map((run) => (
            <li key={run}>{run}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Per-Run values of a mixed or not-aggregated cell. */
function PerRunDetails({
  cell,
  column,
}: {
  cell: Extract<ResultsCellPayload, { kind: 'mixed' | 'per_run' }>
  column: ResultTableColumn
}) {
  return (
    <ul className="space-y-0.5 text-[11px]" data-slot="results-per-run-details">
      {cell.perRun.map((item) => (
        <li key={item.run} className="flex justify-between gap-3">
          <span className="font-mono text-[10px] text-muted-foreground">{item.run}</span>
          <span className="font-mono tabular-nums">
            {item.value !== null && typeof item.value === 'object' && !Array.isArray(item.value)
              ? Object.entries(item.value as Record<string, number | null>)
                  .sort(([a], [b]) => compareStatKeys(a, b))
                  .map(([key, value]) => `${key}=${value ?? '—'}`)
                  .join(', ')
              : resultValueText(item.value as never, column.result) || '—'}
          </span>
        </li>
      ))}
    </ul>
  )
}

function ResultValueCell({ column, variant, sotaRank }: ResultCellProps) {
  const cell = column.getCell?.(variant)
  const text = column.getText(variant)
  if (!cell || (text === '' && cell.kind === 'value')) return <EmptyValue />
  const numeric =
    column.result?.type === 'number' || column.result?.type === 'stats' || cell.kind === 'stats'
  const body = (
    <span
      className={cn(
        'inline-flex items-baseline gap-1',
        numeric && 'tabular-nums',
        cell.source === 'planned' && 'italic text-muted-foreground',
      )}
      data-cell-kind={cell.kind}
      data-cell-source={cell.source}
      title={cell.source === 'planned' ? 'Planned value (no evidence Run yet)' : undefined}
    >
      <span className={sotaRankClass(sotaRank)}>{text === '' ? '—' : renderCellText(text)}</span>
      <CellMarkers cell={cell} column={column} />
    </span>
  )
  if (cell.kind !== 'stats' && cell.kind !== 'mixed' && cell.kind !== 'per_run') return body
  return (
    <HoverCard openDelay={200} closeDelay={80}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className="cursor-help rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          aria-label={`${column.label}: ${text || 'empty'} (show statistics)`}
        >
          {body}
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-64" aria-label={`${column.label} statistics`}>
        {cell.kind === 'stats' ? (
          <StatsDetails cell={cell} column={column} />
        ) : (
          <PerRunDetails cell={cell} column={column} />
        )}
        {cell.differsFromPlan && (
          <p className="mt-1.5 text-[10px] text-amber-700 dark:text-amber-300">
            Planned: {resultValueText(cell.planned, column.result) || '—'}
          </p>
        )}
      </HoverCardContent>
    </HoverCard>
  )
}

/** Bounds a cell to `maxLines` visual lines (1.25rem each). */
export function CellClamp({
  maxLines,
  title,
  focusable = false,
  children,
  className,
  style,
  ...triggerProps
}: {
  maxLines: number
  title?: string
  focusable?: boolean
  children: ReactNode
} & Omit<ComponentProps<'div'>, 'children' | 'title'>) {
  return (
    <div
      {...triggerProps}
      className={cn('overflow-hidden whitespace-normal break-words text-xs/5', className)}
      style={{ ...style, maxHeight: `calc(${maxLines} * 1.25rem)` }}
      title={title}
      tabIndex={focusable ? 0 : undefined}
      data-has-description={focusable || undefined}
      data-max-lines={maxLines}
    >
      {children}
    </div>
  )
}

export function EmptyValue() {
  return <span className="text-muted-foreground">—</span>
}

/** `<br>` variants and newlines become real line breaks. */
export function renderTextWithBreaks(value: string): ReactNode {
  return keyedLines(value).map(({ key, line }, position) => (
    <Fragment key={key}>
      {position > 0 && <br />}
      {line}
    </Fragment>
  ))
}

function renderCellText(value: string): ReactNode {
  return keyedLines(value).map(({ key, line }, position) => {
    const wandbUrl = parseWandbUrl(line)
    return (
      <Fragment key={key}>
        {position > 0 && <br />}
        {wandbUrl ? <WandbLink {...wandbUrl} /> : line}
      </Fragment>
    )
  })
}

function WandbLink({ href, label }: { href: string; label: string }) {
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            title={href}
            className="inline-flex max-w-56 items-center gap-1 rounded-sm px-0.5 font-mono text-[10px] text-primary underline decoration-primary/40 underline-offset-2 hover:bg-primary/10 hover:decoration-primary"
            aria-label={`Open W&B link ${label}`}
          >
            <ChartSpline className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{label}</span>
          </a>
        </TooltipTrigger>
        <TooltipContent side="top" align="start" className="max-w-md break-all font-mono">
          {href}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
