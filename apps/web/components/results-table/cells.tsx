'use client'

import type { ResultsVariantEligibility, ResultVariant, VariantStatus } from '@memon/core'
import { ChartSpline } from 'lucide-react'
import Link from 'next/link'
import { type ComponentProps, Fragment, type ReactNode } from 'react'
import { type ProjectTarget, projectWebPath } from '../../lib/api'
import {
  formatScalar,
  gitBlobUrl,
  gitCommitUrl,
  keyedLines,
  parseWandbUrl,
  sotaRankClass,
} from '../../lib/experiment-results/format'
import type { ResultTableColumn, SotaRank } from '../../lib/experiment-results/types'
import { cn } from '../../lib/utils'
import { TranslatedLiteral } from '../body-translation'
import { Badge } from '../ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import { VariantStatusBadge } from '../variant-status-badge'

export interface ResultCellProps {
  column: ResultTableColumn
  variant: ResultVariant
  project: ProjectTarget
  experimentId: string
  /** Run ids declared by the Experiment; only these link into Run panels. */
  declaredRunIds: ReadonlySet<string>
  sotaRank?: SotaRank
  decimalPlaces?: number
  eligibility?: ResultsVariantEligibility
}

/** Dispatches to the renderer for the column's value kind. */
export function ResultCell(props: ResultCellProps) {
  const { column } = props
  if (column.kind === 'variant') return <VariantCell {...props} />
  if (column.kind === 'status') return <StatusCell status={props.variant.status} />
  if (column.kind === 'runs' || column.kind === 'attempts') return <RunListCell {...props} />
  return <ScalarCell {...props} />
}

function VariantCell({ variant, eligibility }: ResultCellProps) {
  const invalidMetrics = eligibility && eligibility.metricsValidity !== 'valid'
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="font-mono text-[10px] font-medium text-muted-foreground">{variant.id}</span>
      <span className="font-medium text-foreground">
        <TranslatedLiteral original={renderTextWithBreaks(variant.name)}>
          {variant.name}
        </TranslatedLiteral>
      </span>
      {invalidMetrics && <Badge variant="outline">metrics {eligibility.metricsValidity}</Badge>}
    </span>
  )
}

export function StatusCell({ status }: { status: VariantStatus }) {
  return <VariantStatusBadge status={status} />
}

function RunListCell({ column, variant, project, experimentId, declaredRunIds }: ResultCellProps) {
  const value = column.getValue(variant)
  const runIds = Array.isArray(value) ? value : []
  if (runIds.length === 0) return <EmptyValue />
  return (
    <div className="space-y-0.5">
      {runIds.map((runId) =>
        // A declared member links into the Experiment page's Run panel; an id
        // the Experiment does not declare stays plain text rather than a link
        // that would open an empty panel.
        declaredRunIds.has(runId) ? (
          <span key={runId} className="block whitespace-nowrap font-mono text-[10px]">
            <Link
              href={`${projectWebPath(project, `/e/${encodeURIComponent(experimentId)}`)}?run=${encodeURIComponent(runId)}`}
              className="text-primary underline-offset-2 hover:underline"
            >
              {runId}
            </Link>
          </span>
        ) : (
          <code key={runId} className="block font-mono text-[10px]">
            {runId}
          </code>
        ),
      )}
    </div>
  )
}

function ScalarCell({ column, variant, sotaRank, decimalPlaces, eligibility }: ResultCellProps) {
  const value = column.getValue(variant)
  if (value === null || value === undefined || value === '' || Array.isArray(value)) {
    return <EmptyValue />
  }
  const { text, decimalFormatted } = formatScalar(value, decimalPlaces)
  const provenanceHref =
    column.kind === 'entry' || column.kind === 'recipe'
      ? gitBlobUrl(variant, text)
      : column.kind === 'commit'
        ? gitCommitUrl(variant)
        : null
  if (provenanceHref) {
    return (
      <a
        href={provenanceHref}
        target="_blank"
        rel="noreferrer noopener"
        className="font-mono text-[10px] text-primary underline-offset-2 hover:underline"
      >
        {renderTextWithBreaks(text)}
      </a>
    )
  }
  const content = renderCellText(text)
  if (column.kind !== 'schema') return <code className="font-mono text-[10px]">{content}</code>
  const invalidMetrics = eligibility && eligibility.metricsValidity !== 'valid'
  return (
    <span
      className={cn(
        (column.schema?.type === 'number' || decimalFormatted) && 'tabular-nums',
        sotaRankClass(sotaRank),
      )}
    >
      {content}
      {column.schema?.group === 'metric' && invalidMetrics && (
        <span title={`Excluded Runs: ${eligibility.deprecatedRuns.join(', ')}`}>
          {' '}
          [{eligibility.metricsValidity}]
        </span>
      )}
    </span>
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
