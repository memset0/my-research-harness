'use client'

// v3 list page — a vertical stack of full-width experiment cards (one per
// docs/experiments/E<NNNN>-<slug>.md). Each card embeds its member runs
// as a compact table.
//
// v4 (lifecycle-frontmatter-v4):
//   - Card pill renders the manual ExperimentStatus from frontmatter, NOT
//     the aggregate of member-run statuses.
//   - Secondary line under the title summarises the run roster ("2 running
//     · 5 done · 1 interrupted") instead of the old <finished>/<total>.
//   - Archived items get a desaturated overlay + Archive icon prefix.
//   - "Show archived" checkbox above the grid; default unchecked. Two
//     listing modes per archive-frontmatter spec:
//       * unchecked → active items first, then a bottom-of-list reveal
//         affordance for an isolated archived bucket.
//       * checked → archived + active interleaved in a single sort.

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, Pencil } from 'lucide-react'
import {
  fetchAnomalies,
  fetchExperimentDocs,
  type ExperimentDocSummary,
  type MemberRunSummary,
  projectHost,
  projectName,
  projectQueryKey,
  type ProjectTarget,
} from '../lib/api'
import { AnomalyBanner } from './anomaly-banner'
import { Badge } from './ui/badge'
import { Checkbox } from './ui/checkbox'
import { ExperimentStatusPill, StatusPill } from './status-pill'
import { cn } from '../lib/utils'

const STORAGE_KEY_SHOW_ARCHIVED = (project: ProjectTarget) =>
  `memon:list:${projectQueryKey(project).join(':')}:show-archived`

function projectBasePath(project: ProjectTarget): string {
  const name = encodeURIComponent(projectName(project))
  const host = projectHost(project)
  return host ? `/h/${encodeURIComponent(host)}/p/${name}` : `/p/${name}`
}

export function ExperimentCardGrid({ project }: { project: ProjectTarget }) {
  const { data: expData, isLoading: expLoading } = useQuery({
    queryKey: ['experiments', ...projectQueryKey(project)],
    queryFn: () => fetchExperimentDocs(project),
  })
  const { data: anomalyData } = useQuery({
    queryKey: ['anomalies', ...projectQueryKey(project)],
    queryFn: () => fetchAnomalies(project),
  })

  const [showArchived, setShowArchived] = useState(false)
  const [revealArchivedBucket, setRevealArchivedBucket] = useState(false)

  // Hydrate the per-project preference from localStorage on first render.
  useEffect(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY_SHOW_ARCHIVED(project))
      if (v === '1') setShowArchived(true)
    } catch {
      // localStorage unavailable (SSR / private mode) — silent default.
    }
  }, [project])

  // Persist on change.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_SHOW_ARCHIVED(project), showArchived ? '1' : '0')
    } catch {
      /* noop */
    }
  }, [project, showArchived])

  if (expLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>
  }

  const experiments = expData?.experiments ?? []

  const sortFn = (a: ExperimentDocSummary, b: ExperimentDocSummary) =>
    b.effectiveUpdatedAt.localeCompare(a.effectiveUpdatedAt)

  const active = experiments
    .filter((e) => !e.frontMatter.archived)
    .slice()
    .sort(sortFn)
  const archived = experiments
    .filter((e) => e.frontMatter.archived)
    .slice()
    .sort(sortFn)
  const integrated = experiments.slice().sort(sortFn)

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">
          Experiments{' '}
          <span className="font-normal text-sm text-muted-foreground">
            ({showArchived ? experiments.length : active.length})
          </span>
        </h2>
        <label
          htmlFor="show-archived-experiments"
          className="ml-auto flex items-center gap-2 text-xs text-muted-foreground"
        >
          <Checkbox
            id="show-archived-experiments"
            checked={showArchived}
            onCheckedChange={(v) => setShowArchived(v === true)}
            aria-label="Show archived experiments"
          />
          Show archived
        </label>
      </div>

      <AnomalyBanner project={project} />

      {showArchived ? (
        <CardList project={project} exps={integrated} />
      ) : (
        <>
          <CardList project={project} exps={active} />
          {archived.length > 0 && (
            <ArchivedBucket
              project={project}
              archived={archived}
              revealed={revealArchivedBucket}
              onToggle={() => setRevealArchivedBucket((v) => !v)}
            />
          )}
        </>
      )}

      {experiments.length === 0 && (
        <div className="text-sm text-muted-foreground">(no experiments yet)</div>
      )}
      {anomalyData?.anomalies.length === 0 && experiments.length > 0 && (
        <div className="text-xs text-muted-foreground">
          No anomalies — all runs bound consistently.
        </div>
      )}
    </div>
  )
}

function CardList({ project, exps }: { project: ProjectTarget; exps: ExperimentDocSummary[] }) {
  return (
    <div className="flex flex-col gap-3">
      {exps.map((exp) => (
        <ExperimentCard key={exp.id} project={project} exp={exp} />
      ))}
    </div>
  )
}

function ArchivedBucket({
  project,
  archived,
  revealed,
  onToggle,
}: {
  project: ProjectTarget
  archived: ExperimentDocSummary[]
  revealed: boolean
  onToggle: () => void
}) {
  const noun = archived.length === 1 ? 'archived experiment' : 'archived experiments'
  return (
    <div className="flex flex-col gap-3 border-t pt-3">
      <button
        type="button"
        onClick={onToggle}
        className="self-start text-xs text-muted-foreground underline-offset-2 hover:underline"
      >
        {revealed ? 'Hide' : 'Show'} {archived.length} {noun}
      </button>
      {revealed && (
        <div className="flex flex-col gap-3 opacity-90">
          {archived.map((exp) => (
            <ExperimentCard key={exp.id} project={project} exp={exp} />
          ))}
        </div>
      )}
    </div>
  )
}

function ExperimentCard({ project, exp }: { project: ProjectTarget; exp: ExperimentDocSummary }) {
  const archived = exp.frontMatter.archived
  const basePath = projectBasePath(project)
  return (
    <article
      className={cn('flex flex-col gap-2 rounded-md border bg-card p-3', archived && 'opacity-60')}
      aria-label={archived ? `${exp.id} (archived)` : exp.id}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          <Link
            href={`${basePath}/e/${encodeURIComponent(exp.id)}`}
            className="truncate font-mono text-xs text-muted-foreground hover:underline"
          >
            {exp.id}
          </Link>
          <Link href={`${basePath}/e/${encodeURIComponent(exp.id)}`} className="hover:underline">
            <h3 className="truncate text-sm font-medium">{exp.frontMatter.title}</h3>
          </Link>
          <div className="text-xs text-muted-foreground">{summariseRoster(exp.memberRuns)}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <ExperimentStatusPill status={exp.frontMatter.status} archived={archived} />
        </div>
      </header>
      {exp.memberRuns.length > 0 && (
        <table className="text-xs">
          <tbody>
            {exp.memberRuns.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="py-1 pr-2">
                  <StatusPill status={r.status as never} archived={r.archived} />
                </td>
                <td className="py-1 pr-2">
                  <Link
                    href={`${basePath}/e/${encodeURIComponent(exp.id)}?run=${encodeURIComponent(r.id)}`}
                    className="font-mono hover:underline"
                  >
                    {r.id}
                  </Link>
                </td>
                <td className="py-1 pr-2 text-muted-foreground">{r.createdAt.slice(11, 16)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
          <span
            className="flex items-center gap-1"
            title="Effective created (min over member runs)"
          >
            <CalendarDays className="size-3" aria-hidden />
            {formatTimestamp(exp.effectiveCreatedAt)}
          </span>
          <span
            className="flex items-center gap-1"
            title="Effective updated (max over member runs)"
          >
            <Pencil className="size-3" aria-hidden />
            {formatTimestamp(exp.effectiveUpdatedAt)}
          </span>
        </div>
      </footer>
    </article>
  )
}

/**
 * v4: secondary-line summary of the run roster. Returns a string like
 * "2 running · 5 done · 1 interrupted" omitting zero-count categories.
 * "no runs yet" when the experiment has no member runs.
 */
function summariseRoster(runs: MemberRunSummary[]): string {
  if (runs.length === 0) return 'no runs yet'
  const counts: Record<string, number> = {
    running: 0,
    done: 0,
    interrupted: 0,
    failed: 0,
    pending: 0,
    unparseable: 0,
  }
  for (const r of runs) {
    switch (r.status) {
      case 'RUNNING':
        counts.running!++
        break
      case 'FINISHED':
        counts.done!++
        break
      case 'INTERRUPTED':
        counts.interrupted!++
        break
      case 'FAILED':
        counts.failed!++
        break
      case 'PENDING':
        counts.pending!++
        break
      default:
        counts.unparseable!++
        break
    }
  }
  const parts: string[] = []
  for (const [label, n] of Object.entries(counts)) {
    if (n > 0) parts.push(`${n} ${label}`)
  }
  return parts.join(' · ')
}

/**
 * Format an ISO8601 string to `YYYY-MM-DD HH:MM:SS` (drop the timezone
 * offset for readability — the value on disk is always with-offset, the
 * displayed-without-offset is fine since memon is single-user).
 */
function formatTimestamp(iso: string): string {
  if (!iso) return '—'
  return iso.slice(0, 19).replace('T', ' ')
}
