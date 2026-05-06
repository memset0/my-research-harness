'use client'

// v3 list page — a responsive grid of experiment cards (one per
// docs/experiments/E<NNNN>-<slug>.md). Each card embeds its member runs
// as a compact table. Orphan runs render as separate grey-bordered cards
// so the user can navigate to them and bind them to an experiment.

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import {
  fetchAnomalies,
  fetchExperiments,
  fetchExperimentDocs,
  type ExperimentDocSummary,
  type IndexedRun,
} from '../lib/api'
import { AnomalyBanner } from './anomaly-banner'
import { Badge } from './ui/badge'
import { StatusPill } from './status-pill'

export function ExperimentCardGrid({ project }: { project: string }) {
  const { data: expData, isLoading: expLoading } = useQuery({
    queryKey: ['experiments-v3', project],
    queryFn: () => fetchExperimentDocs(project),
  })
  const { data: runData, isLoading: runLoading } = useQuery({
    queryKey: ['runs', project],
    queryFn: () => fetchExperiments(project),
  })
  const { data: anomalyData } = useQuery({
    queryKey: ['anomalies', project],
    queryFn: () => fetchAnomalies(project),
  })

  if (expLoading || runLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>
  }

  const experiments = expData?.experiments ?? []
  const runs = runData?.experiments ?? []

  // Compute which runs are confirmed members of some experiment so we can
  // surface the rest as orphans. A confirmed member appears in some
  // exp.memberRuns[].id list.
  const confirmedRunIds = new Set<string>()
  for (const exp of experiments) {
    for (const r of exp.memberRuns) confirmedRunIds.add(r.id)
  }
  const orphanRuns = runs.filter((r) => !confirmedRunIds.has(r.id))

  // Sort exps by effectiveUpdatedAt descending.
  const sortedExps = experiments
    .slice()
    .sort((a, b) => b.effectiveUpdatedAt.localeCompare(a.effectiveUpdatedAt))

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <AnomalyBanner project={project} />
      <h2 className="text-lg font-semibold">
        Experiments <span className="font-normal text-sm text-muted-foreground">({sortedExps.length})</span>
      </h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sortedExps.map((exp) => (
          <ExperimentCard key={exp.id} project={project} exp={exp} />
        ))}
        {orphanRuns.map((r) => (
          <OrphanCard key={r.id} project={project} run={r} />
        ))}
      </div>
      {sortedExps.length === 0 && orphanRuns.length === 0 && (
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
            className="truncate font-mono text-sm font-semibold hover:underline"
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
            <Badge key={t} variant="outline" className="text-xs">
              #{t}
            </Badge>
          ))}
        </div>
        <div className="ml-auto flex shrink-0 gap-3">
          <span>📅 {exp.effectiveCreatedAt.slice(0, 10)}</span>
          <span>✎ {exp.effectiveUpdatedAt.slice(0, 10)}</span>
        </div>
      </footer>
    </article>
  )
}

function OrphanCard({ project, run }: { project: string; run: IndexedRun }) {
  return (
    <article className="flex flex-col gap-2 rounded-md border-2 border-dashed border-muted bg-muted/20 p-3">
      <header className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">⚠ Unassigned</span>
          <span className="truncate font-mono text-sm">{run.id}</span>
        </div>
        <StatusPill status={run.frontMatter.status} />
      </header>
      <div className="text-xs text-muted-foreground">
        Bind this run to an experiment via{' '}
        <code className="rounded bg-muted px-1 font-mono">memon experiment link</code> or
        create one via <code className="rounded bg-muted px-1 font-mono">memon experiment create … --from-run {run.id}</code>.
      </div>
    </article>
  )
}
