'use client'

import { useQuery } from '@tanstack/react-query'
import { Clock3, Search } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import {
  type ExperimentListRow,
  fetchExperimentDocs,
  type ProjectTarget,
  projectHost,
  projectName,
  projectQueryKey,
} from '../lib/api'
import {
  compareExperimentNavigation,
  EXPERIMENT_GROUPS,
  experimentGroup,
  shortExperimentId,
} from '../lib/experiment-navigation'
import { queryKeys } from '../lib/query-keys'
import { cn } from '../lib/utils'
import { ExperimentNavigationGroup } from './experiment-navigation-group'
import { ExperimentStatusPill } from './status-pill'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

function projectBasePath(project: ProjectTarget): string {
  const name = encodeURIComponent(projectName(project))
  const host = projectHost(project)
  return host ? `/h/${encodeURIComponent(host)}/p/${name}` : `/p/${name}`
}

export function ExperimentCardGrid({ project }: { project: ProjectTarget }) {
  return <ExperimentGroups key={projectQueryKey(project).join(':')} project={project} />
}

function ExperimentGroups({ project }: { project: ProjectTarget }) {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.experiments(project),
    queryFn: () => fetchExperimentDocs(project),
  })
  const [lifecycle, setLifecycle] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const all = data?.experiments ?? []
  const needle = search.trim().toLowerCase()
  const groups = EXPERIMENT_GROUPS.map((group) => ({
    ...group,
    items: all.filter((e) => experimentGroup(e) === group.key),
  })).filter((group) => group.items.length > 0)
  const filtered = all
    .filter(
      (e) =>
        (lifecycle === 'all' || experimentGroup(e) === lifecycle) &&
        (statusFilter === 'all' || (e.displayStatus ?? e.frontMatter.status) === statusFilter) &&
        (!needle ||
          [e.id, e.frontMatter.title, ...e.frontMatter.tags].some((s) =>
            s.toLowerCase().includes(needle),
          )),
    )
    .sort(compareExperimentNavigation)
  const forceOpen = lifecycle !== 'all' || statusFilter !== 'all' || needle.length > 0
  const statusOptions = [
    ...new Set(
      all
        .filter((e) => experimentGroup(e) !== 'UNKNOWN')
        .map((e) => e.displayStatus ?? e.frontMatter.status),
    ),
  ]

  return (
    <div className="flex min-w-0 flex-col gap-5 p-4 md:p-6">
      <header className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">
            Experiments{' '}
            <span className="ml-1 text-sm font-normal text-muted-foreground">{all.length}</span>
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Research lifecycle · running and completed describe progress within active work.
          </p>
        </div>
        <fieldset aria-label="Filter experiment lifecycle" className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant={lifecycle === 'all' ? 'secondary' : 'ghost'}
            aria-pressed={lifecycle === 'all'}
            onClick={() => {
              setLifecycle('all')
              setStatusFilter('all')
            }}
          >
            All <span className="ml-1 text-muted-foreground tabular-nums">{all.length}</span>
          </Button>
          {groups.map((group) => (
            <Button
              key={group.key}
              size="sm"
              variant={lifecycle === group.key ? 'secondary' : 'ghost'}
              aria-pressed={lifecycle === group.key}
              onClick={() => {
                setLifecycle(group.key)
                setStatusFilter('all')
              }}
            >
              {group.label}
              <span className="ml-1 text-muted-foreground tabular-nums">{group.items.length}</span>
            </Button>
          ))}
        </fieldset>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-52">
            <Search
              className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              aria-label="Search experiments"
              placeholder="Search title, ID or tag…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44" aria-label="Filter experiment status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All progress / statuses</SelectItem>
              {statusOptions.map((status) => (
                <SelectItem key={status} value={status}>
                  {status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {forceOpen && (
            <span className="text-xs text-muted-foreground">
              {filtered.length} of {all.length}
            </span>
          )}
        </div>
      </header>
      {isLoading && (
        <p className="text-sm text-muted-foreground" role="status">
          Loading experiments…
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          Could not load experiments.{' '}
          {data ? 'Showing the last available list.' : 'Try again shortly.'}
        </p>
      )}
      <div className="space-y-4">
        {groups.map((group) => {
          const items = filtered.filter((e) => experimentGroup(e) === group.key)
          return (
            items.length > 0 && (
              <ExperimentNavigationGroup
                key={group.key}
                group={group}
                count={items.length}
                forceOpen={forceOpen}
              >
                <div className="grid grid-cols-1 gap-2">
                  {items.map((exp) => (
                    <ExperimentCard key={exp.id} project={project} exp={exp} />
                  ))}
                </div>
              </ExperimentNavigationGroup>
            )
          )
        })}
      </div>
      {!isLoading && !error && filtered.length === 0 && (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {all.length ? 'No experiments match these filters.' : 'No experiments yet.'}
        </p>
      )}
    </div>
  )
}

function ExperimentCard({ project, exp }: { project: ProjectTarget; exp: ExperimentListRow }) {
  const group = experimentGroup(exp)
  const historical = ['ARCHIVED', 'RETIRED', 'LEGACY_ARCHIVED'].includes(group)
  const href = `${projectBasePath(project)}/e/${encodeURIComponent(exp.id)}`
  return (
    <article
      className={cn(
        'min-w-0 rounded-lg border bg-card p-3 transition-colors hover:border-foreground/25 sm:p-4',
        historical && 'bg-muted/20',
      )}
      aria-label={exp.id}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={href}
          prefetch={false}
          className="font-mono text-xs text-muted-foreground hover:underline"
          title={exp.id}
        >
          {shortExperimentId(exp.id)}
        </Link>
        {group === 'UNKNOWN' ? (
          <Badge variant="outline">Status unavailable</Badge>
        ) : (
          <ExperimentStatusPill
            status={exp.displayStatus ?? exp.frontMatter.status}
            archived={historical}
            className="text-[10px]"
          />
        )}
        <span
          className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground"
          title={`Updated ${exp.effectiveUpdatedAt}`}
        >
          <Clock3 className="size-3" aria-hidden />
          <time dateTime={exp.effectiveUpdatedAt}>
            {exp.effectiveUpdatedAt.slice(0, 16).replace('T', ' ') || '—'}
          </time>
        </span>
      </div>
      <Link
        href={href}
        prefetch={false}
        className="mt-2 block hover:underline"
        title={exp.frontMatter.title}
      >
        <h3 className="line-clamp-2 break-words text-sm font-medium leading-relaxed">
          {exp.frontMatter.title || exp.id}
        </h3>
      </Link>
      {exp.frontMatter.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {exp.frontMatter.tags.map((tag) => (
            <Badge
              key={tag}
              variant="outline"
              className="max-w-full break-all whitespace-normal text-[10px] font-normal"
            >
              #{tag}
            </Badge>
          ))}
        </div>
      )}
      {['PAUSED', 'ARCHIVED', 'RETIRED'].includes(exp.frontMatter.status) &&
        (exp.runningRunCount ?? 0) > 0 && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
            {exp.runningRunCount} Runs still running
          </p>
        )}
    </article>
  )
}
