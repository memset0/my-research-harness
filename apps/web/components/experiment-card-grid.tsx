'use client'

// Lifecycle and current-generation progress arrive from the shared backend
// projection; this view never fetches individual Runs or result files.

import { useQuery } from '@tanstack/react-query'
import { CalendarDays, Pencil } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import {
  type ExperimentListRow,
  fetchExperimentDocs,
  type ProjectTarget,
  projectHost,
  projectName,
  projectQueryKey,
} from '../lib/api'
import { queryKeys } from '../lib/query-keys'
import { cn } from '../lib/utils'
import { ExperimentStatusPill } from './status-pill'
import { Badge } from './ui/badge'
import { Checkbox } from './ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

const STORAGE_KEY_SHOW_ARCHIVED = (project: ProjectTarget) =>
  `memon:list:${projectQueryKey(project).join(':')}:show-archived`

function isArchived(exp: ExperimentListRow): boolean {
  return (
    ['ARCHIVED', 'RETIRED'].includes(exp.frontMatter.status) ||
    (['OPEN', 'RESOLVED', 'ABANDONED'].includes(exp.frontMatter.status) && exp.frontMatter.archived)
  )
}

function projectBasePath(project: ProjectTarget): string {
  const name = encodeURIComponent(projectName(project))
  const host = projectHost(project)
  return host ? `/h/${encodeURIComponent(host)}/p/${name}` : `/p/${name}`
}

export function ExperimentCardGrid({ project }: { project: ProjectTarget }) {
  const { data: expData, isLoading: expLoading } = useQuery({
    queryKey: queryKeys.experiments(project),
    queryFn: () => fetchExperimentDocs(project),
  })

  const [statusFilter, setStatusFilter] = useState('all')
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

  const allExperiments = expData?.experiments ?? []
  const statusOptions = [
    ...new Set(allExperiments.map((e) => e.displayStatus ?? e.frontMatter.status)),
  ]
  const experiments = allExperiments.filter(
    (e) => statusFilter === 'all' || (e.displayStatus ?? e.frontMatter.status) === statusFilter,
  )

  const sortFn = (a: ExperimentListRow, b: ExperimentListRow) =>
    b.effectiveUpdatedAt.localeCompare(a.effectiveUpdatedAt)

  const active = experiments
    .filter((e) => !isArchived(e))
    .slice()
    .sort(sortFn)
  const archived = experiments
    .filter((e) => isArchived(e))
    .slice()
    .sort(sortFn)
  const integrated = experiments.slice().sort(sortFn)

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={statusFilter}
          onValueChange={(value) => {
            setStatusFilter(value)
            if (value === 'ARCHIVED' || value === 'RETIRED') setShowArchived(true)
          }}
        >
          <SelectTrigger className="w-40" aria-label="Filter experiment status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {statusOptions.map((status) => (
              <SelectItem key={status} value={status}>
                {status}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

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
          Show archived and retired
        </label>
      </div>

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
    </div>
  )
}

function CardList({ project, exps }: { project: ProjectTarget; exps: ExperimentListRow[] }) {
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
  archived: ExperimentListRow[]
  revealed: boolean
  onToggle: () => void
}) {
  const noun =
    archived.length === 1 ? 'archived or retired experiment' : 'archived or retired experiments'
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

function ExperimentCard({ project, exp }: { project: ProjectTarget; exp: ExperimentListRow }) {
  const archived = isArchived(exp)
  const basePath = projectBasePath(project)
  return (
    <article
      className={cn('flex flex-col gap-2 rounded-md border bg-card p-3', archived && 'opacity-60')}
      aria-label={
        archived
          ? `${exp.id} (${exp.frontMatter.status === 'RETIRED' ? 'retired' : 'archived'})`
          : exp.id
      }
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          <Link
            href={`${basePath}/e/${encodeURIComponent(exp.id)}`}
            prefetch={false}
            className="truncate font-mono text-xs text-muted-foreground hover:underline"
          >
            {exp.id}
          </Link>
          <Link
            href={`${basePath}/e/${encodeURIComponent(exp.id)}`}
            prefetch={false}
            className="hover:underline"
          >
            <h3 className="truncate text-sm font-medium">{exp.frontMatter.title}</h3>
          </Link>
        </div>
        <div className="flex max-w-1/2 flex-wrap items-center justify-end gap-1.5">
          {['PAUSED', 'ARCHIVED', 'RETIRED'].includes(exp.frontMatter.status) &&
            (exp.runningRunCount ?? 0) > 0 && (
              <span className="text-xs text-amber-700 dark:text-amber-300">
                {exp.runningRunCount} Runs still running
              </span>
            )}
          <ExperimentStatusPill
            status={exp.displayStatus ?? exp.frontMatter.status}
            archived={archived}
          />
        </div>
      </header>
      <footer className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <div className="flex flex-wrap gap-1">
          {exp.frontMatter.tags.map((t) => (
            <Badge key={t} variant="outline" className="text-[10px]">
              #{t}
            </Badge>
          ))}
        </div>
        <div className="ml-auto flex shrink-0 gap-3 font-mono">
          <span className="flex items-center gap-1" title="Created">
            <CalendarDays className="size-3" aria-hidden />
            {formatTimestamp(exp.effectiveCreatedAt)}
          </span>
          <span className="flex items-center gap-1" title="Updated">
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
  return iso.slice(0, 19).replace('T', ' ')
}
