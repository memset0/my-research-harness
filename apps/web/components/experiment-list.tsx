'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { fetchExperiments, type IndexedRun } from '../lib/api'
import { queryKeys } from '../lib/query-keys'
import { cn } from '../lib/utils'
import { WarningBadge } from './colored-badge'
import { ListSkeleton } from './skeletons'
import { StatusPill } from './status-pill'
import { TimestampLocal } from './timestamp'
import { Badge } from './ui/badge'
import { Input } from './ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

const STATUS_VALUES = ['PENDING', 'RUNNING', 'FINISHED', 'FAILED', 'UNKNOWN'] as const

export function ExperimentList({ project }: { project: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.runs(project),
    queryFn: () => fetchExperiments(project),
  })
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const experiments: IndexedRun[] = data?.experiments ?? []
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return experiments.filter((e) => {
      if (statusFilter !== 'all' && e.frontMatter.status !== statusFilter) return false
      if (!needle) return true
      const fields = [
        e.id,
        e.frontMatter.name,
        e.frontMatter.project, // sub-project label
        ...e.frontMatter.tags,
        ...e.frontMatter.hypotheses,
      ]
      return fields.some((f) => f.toLowerCase().includes(needle))
    })
  }, [experiments, search, statusFilter])

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          placeholder="filter by id / name / tag / hypothesis…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[12rem]"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[10rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">all status</SelectItem>
            {STATUS_VALUES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          {filtered.length} / {experiments.length}
        </span>
      </div>

      {isLoading && experiments.length === 0 && <ListSkeleton count={6} />}
      {error && <div className="text-sm text-destructive">error: {(error as Error).message}</div>}

      <div className="hidden grid-cols-12 items-center gap-3 border-b pb-2 text-[10px] uppercase tracking-wide text-muted-foreground md:grid">
        <div className="col-span-5">id</div>
        <div className="col-span-2">sub-project</div>
        <div className="col-span-2">created</div>
        <div className="col-span-3">updated</div>
      </div>
      <div className="flex flex-col gap-1">
        {filtered.map((e) => (
          <ExperimentRow key={e.id} project={project} exp={e} />
        ))}
        {filtered.length === 0 && !isLoading && (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            no experiments match
          </div>
        )}
      </div>
    </div>
  )
}

function ExperimentRow({ project, exp }: { project: string; exp: IndexedRun }) {
  const noReadme = !exp.hasReadme
  // Show the front-matter `project:` value as a sub-project tag only when it
  // adds information — i.e., non-empty AND distinct from the membership
  // project (set from config.yml). Empty or equal: render nothing.
  const subProject = exp.frontMatter.project
  const showSubProject = subProject !== '' && subProject !== exp.project
  const hasChips =
    exp.frontMatter.hypotheses.length > 0 || exp.frontMatter.tags.length > 0 || noReadme
  return (
    <Link
      href={`/p/${encodeURIComponent(project)}/experiments/${encodeURIComponent(exp.id)}`}
      className={cn(
        'block rounded-md border bg-card transition hover:border-foreground/40',
        noReadme && 'opacity-60',
      )}
    >
      <div className="px-3 py-1.5">
        {/* Top stripe: id (with status pill inline) | sub-project | created | updated */}
        <div className="grid grid-cols-1 gap-2 md:grid-cols-12 md:items-center md:gap-3">
          <div className="flex min-w-0 items-center gap-2 md:col-span-5">
            <span className="truncate font-mono text-xs">{exp.id}</span>
            <StatusPill status={exp.frontMatter.status} stale={exp.stale} />
          </div>
          <div className="min-w-0 md:col-span-2">
            {showSubProject && (
              <Badge
                variant="secondary"
                className="max-w-full truncate px-1.5 py-0 text-[10px] font-normal"
                title={`sub-project: ${subProject}`}
              >
                {subProject}
              </Badge>
            )}
          </div>
          <div className="md:col-span-2">
            <TimestampLocal value={exp.frontMatter.createdAt} />
          </div>
          <div className="md:col-span-3">
            <TimestampLocal value={new Date(exp.mtime).toISOString()} />
          </div>
        </div>
        {/* Chip line: hypotheses → tags → no-README warning. Hidden when empty. */}
        {hasChips && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {exp.frontMatter.hypotheses.map((h) => (
              <Badge key={h}>{h}</Badge>
            ))}
            {exp.frontMatter.tags.map((t) => (
              <Badge key={t} variant="outline">
                {t}
              </Badge>
            ))}
            {noReadme && <WarningBadge>no README</WarningBadge>}
          </div>
        )}
      </div>
    </Link>
  )
}
