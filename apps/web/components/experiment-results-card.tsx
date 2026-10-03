'use client'

// The Results card of an Experiment page (FS v9): the table rendered from the
// generated Results summary, or its blocking error; `Last updated` / `Stale
// for` from the newest input modification time; and a Refresh that asks the
// Results snapshot endpoint (every input fingerprint re-taken) and replaces
// only this card's content. The detail response supplies the first summary
// and time, so first render needs no extra request; later detail updates
// (the shared heartbeat) apply like a refresh. A summary too large for the
// detail (`summaryDeferred`) is loaded from the Results endpoint instead. An invalid or missing
// description file keeps the last good table with a local error; a schema
// mismatch or duplicate row replaces the table.

import { RefreshCw, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useReducer } from 'react'
import { fetchExperimentResults, type ProjectTarget } from '../lib/api'
import type {
  ExperimentDisplaySection,
  ExperimentResultsDocumentPayload,
} from '../lib/dto/experiments'
import {
  displayedUpdatedAt,
  initialResultsCardState,
  resultsCardReducer,
} from '../lib/experiment-results/results-card-state'
import { cn } from '../lib/utils'
import { TranslatedLiteral } from './body-translation'
import { ExperimentResultsTable } from './experiment-results-table'
import { useResourceHeartbeat } from './resource-heartbeat-provider'
import { ResultsErrorCard } from './results-table/results-error-card'
import { TimestampLocal } from './timestamp'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'

export function ExperimentResultsCard({
  section,
  results,
  updatedAt,
  project,
  experimentId,
  runIds,
}: {
  section: ExperimentDisplaySection
  results: ExperimentResultsDocumentPayload
  /** Newest input modification time from the Experiment detail. */
  updatedAt: string | null
  project: ProjectTarget
  experimentId: string
  runIds: string[]
}) {
  const [state, dispatch] = useReducer(resultsCardReducer, null, () =>
    initialResultsCardState(results.summary, updatedAt),
  )
  // A changed detail payload (the shared heartbeat) applies like a refresh;
  // an unchanged one keeps its object identity and changes nothing.
  useEffect(() => {
    dispatch({ type: 'summary', summary: results.summary, updatedAt })
  }, [results.summary, updatedAt])

  const refresh = async () => {
    dispatch({ type: 'refresh-start' })
    dispatch({
      type: 'refresh-done',
      outcome: await fetchExperimentResults(project, experimentId),
    })
  }
  // A summary too large to embed in the detail is deferred: the card loads it
  // from the Results endpoint on mount and again when the detail reports a
  // newer input time (the heartbeat analogue of an embedded summary).
  const deferred = results.summary === null && Boolean(results.summaryDeferred)
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload only when the deferred state or the input time changes
  useEffect(() => {
    if (!deferred) return
    let cancelled = false
    dispatch({ type: 'refresh-start' })
    void fetchExperimentResults(project, experimentId).then((outcome) => {
      if (!cancelled) dispatch({ type: 'refresh-done', outcome })
    })
    return () => {
      cancelled = true
    }
  }, [deferred, updatedAt, experimentId])
  const errors = section.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
  const shownAt = displayedUpdatedAt(state)
  return (
    <Card data-section-heading="Results" data-managed-source={section.source} data-supported="true">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>
          <TranslatedLiteral>Results</TranslatedLiteral>
        </CardTitle>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <Badge
            variant="secondary"
            title="Generated from experiment.json and each member Run's result.csv"
          >
            Generated summary
          </Badge>
          {results.legacyResultsYaml && (
            <Badge
              variant="outline"
              className="border-amber-500/60"
              title="LEGACY_RESULTS_YAML: results.yaml is retired in FS v9 and is not read"
            >
              results.yaml ignored
            </Badge>
          )}
          <ResultsSnapshotStatus key={shownAt ?? 'unknown'} updatedAt={shownAt} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={state.pending}
            onClick={() => void refresh()}
            aria-label="Refresh Results"
            data-results-refresh
          >
            <RefreshCw className={cn('size-3.5', state.pending && 'animate-spin')} aria-hidden />
            {state.pending ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {state.localError && (
          <div
            role="status"
            className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100"
            data-slot="results-local-error"
          >
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 break-words">
              {state.localError} The last good Results stay displayed; Refresh to retry.
            </span>
          </div>
        )}
        {errors.length > 0 && !state.blocking && (
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            {errors.map((diagnostic) => (
              <li key={`${diagnostic.code}:${diagnostic.message}`}>
                <code>{diagnostic.code}</code>: {diagnostic.message}
              </li>
            ))}
          </ul>
        )}
        {state.blocking ? (
          <ResultsErrorCard error={state.blocking.error} />
        ) : state.good ? (
          <ExperimentResultsTable
            summary={state.good.summary}
            project={project}
            experimentId={experimentId}
            runIds={runIds}
          />
        ) : deferred && state.pending ? (
          <div
            className="rounded-md border border-dashed px-3 py-8 text-center text-xs italic text-muted-foreground"
            data-results-deferred-loading
          >
            Loading the Results table…
          </div>
        ) : (
          <div className="rounded-md border border-dashed px-3 py-8 text-center text-xs italic text-muted-foreground">
            The Results summary is not available.
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ResultsSnapshotStatus({ updatedAt }: { updatedAt: string | null }) {
  // Age advances with the shared foreground heartbeat rather than a per-card
  // timer; the timer never triggers a backend request.
  const { tick } = useResourceHeartbeat()
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is the heartbeat clock that refreshes now
  const now = useMemo(() => Date.now(), [tick])
  return (
    <div
      className="flex h-7 items-center gap-1.5 rounded-md border bg-muted/30 px-2 text-[10px] text-muted-foreground"
      data-results-snapshot-status
      title={
        updatedAt
          ? `Results inputs last changed at ${updatedAt}`
          : 'Results change time unavailable'
      }
    >
      <span className="whitespace-nowrap">
        Last updated <TimestampLocal value={updatedAt} />
      </span>
      <span aria-hidden>·</span>
      <span className="whitespace-nowrap" data-results-stale-for>
        Stale for {formatResultsAge(updatedAt, now)}
      </span>
    </div>
  )
}

export function formatResultsAge(updatedAt: string | null, now: number): string {
  const updatedTime = updatedAt ? new Date(updatedAt).getTime() : Number.NaN
  if (!Number.isFinite(updatedTime)) return 'unknown'
  const elapsedSeconds = Math.max(0, Math.floor((now - updatedTime) / 1_000))
  if (elapsedSeconds < 60) return `${elapsedSeconds}s`
  const minutes = Math.floor(elapsedSeconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}
