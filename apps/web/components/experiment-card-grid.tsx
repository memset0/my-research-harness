'use client'

// v3 list page — a vertical stack of full-width experiment cards (one per
// docs/experiments/E<NNNN>-<slug>.md). Each card embeds its member runs
// as a compact table. Orphan runs do NOT render in the grid — they appear
// only in the AnomalyBanner above (avoids duplicate surfacing).

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, Pencil } from 'lucide-react'
import {
  fetchAnomalies,
  fetchExperimentDocs,
  type ExperimentDocSummary,
} from '../lib/api'
import { AnomalyBanner } from './anomaly-banner'
import { Badge } from './ui/badge'
import { StatusPill } from './status-pill'

export function ExperimentCardGrid({ project }: { project: string }) {
  const { data: expData, isLoading: expLoading } = useQuery({
    queryKey: ['experiments', project],
    queryFn: () => fetchExperimentDocs(project),
  })
  const { data: anomalyData } = useQuery({
    queryKey: ['anomalies', project],
    queryFn: () => fetchAnomalies(project),
  })

  if (expLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>
  }

  const experiments = expData?.experiments ?? []

  // Sort exps by effectiveUpdatedAt descending.
  const sortedExps = experiments
    .slice()
    .sort((a, b) => b.effectiveUpdatedAt.localeCompare(a.effectiveUpdatedAt))

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <h2 className="text-lg font-semibold">
        Experiments <span className="font-normal text-sm text-muted-foreground">({sortedExps.length})</span>
      </h2>
      <AnomalyBanner project={project} />
      <div className="flex flex-col gap-3">
        {sortedExps.map((exp) => (
          <ExperimentCard key={exp.id} project={project} exp={exp} />
        ))}
      </div>
      {sortedExps.length === 0 && (
        <div className="text-sm text-muted-foreground">(no experiments yet)</div>
      )}
      {anomalyData?.anomalies.length === 0 && experiments.length > 0 && (
        <div className="text-xs text-muted-foreground">No anomalies — all runs bound consistently.</div>
      )}
    </div>
  )
}

function ExperimentCard({ project, exp }: { project: string; exp: ExperimentDocSummary }) {
  const finished = exp.memberRuns.filter((r) => r.status === 'FINISHED').length
  const total = exp.memberRuns.length
  const aggregateStatus =
    exp.memberRuns.find((r) => r.status === 'RUNNING')?.status ??
    exp.memberRuns.find((r) => r.status === 'FAILED')?.status ??
    (total === 0 ? 'PENDING' : finished === total ? 'FINISHED' : 'PENDING')

  return (
    <article className="flex flex-col gap-2 rounded-md border bg-card p-3">
      <header className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          <Link
            href={`/p/${encodeURIComponent(project)}/e/${encodeURIComponent(exp.id)}`}
            className="truncate font-mono text-xs text-muted-foreground hover:underline"
          >
            {exp.id}
          </Link>
          <h3 className="truncate text-sm font-medium">{exp.frontMatter.title}</h3>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <StatusPill status={aggregateStatus as never} />
          <span className="text-xs text-muted-foreground">
            {finished} / {total}
          </span>
        </div>
      </header>
      {exp.memberRuns.length > 0 && (
        <table className="text-xs">
          <tbody>
            {exp.memberRuns.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="py-1 pr-2">
                  <StatusPill status={r.status as never} />
                </td>
                <td className="py-1 pr-2">
                  <Link
                    href={`/p/${encodeURIComponent(project)}/e/${encodeURIComponent(exp.id)}?run=${encodeURIComponent(r.id)}`}
                    className="font-mono hover:underline"
                  >
                    {r.id}
                  </Link>
                </td>
                <td className="py-1 pr-2 text-muted-foreground">
                  {r.createdAt.slice(11, 16)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {exp.memberRuns.length === 0 && (
        <div className="text-xs text-muted-foreground">(no runs yet)</div>
      )}
      <footer className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <div className="flex flex-wrap gap-1">
          {exp.frontMatter.tags.map((t) => (
            <Badge key={t} variant="outline" className="text-[10px]">
              #{t}
            </Badge>
          ))}
        </div>
        <div className="ml-auto flex shrink-0 gap-3 font-mono">
          <span className="flex items-center gap-1" title="Effective created (min over member runs)">
            <CalendarDays className="size-3" aria-hidden />
            {formatTimestamp(exp.effectiveCreatedAt)}
          </span>
          <span className="flex items-center gap-1" title="Effective updated (max over member runs)">
            <Pencil className="size-3" aria-hidden />
            {formatTimestamp(exp.effectiveUpdatedAt)}
          </span>
        </div>
      </footer>
    </article>
  )
}

/**
 * Format an ISO8601 string to `YYYY-MM-DD HH:MM:SS` (drop the timezone
 * offset for readability — the value on disk is always with-offset, the
 * displayed-without-offset is fine since memon is single-user).
 */
function formatTimestamp(iso: string): string {
  if (!iso) return '—'
  // ISO shape: 2026-05-04T10:00:00+08:00
  // Take first 19 chars (YYYY-MM-DDTHH:MM:SS), replace T with space.
  return iso.slice(0, 19).replace('T', ' ')
}
