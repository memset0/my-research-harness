'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { fetchExperiments, type IndexedExperiment } from '../lib/api'
import { Badge, Card, StatusPill } from './ui'
import { TimestampLocal } from './timestamp'
import { NewExperimentButton } from './new-experiment-button'
import { ListSkeleton } from './skeletons'

const STATUS_VALUES = ['PENDING', 'RUNNING', 'FINISHED', 'FAILED', 'UNKNOWN'] as const

export function ExperimentList({ project }: { project: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['experiments', project],
    queryFn: () => fetchExperiments(project),
  })
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const experiments: IndexedExperiment[] = data?.experiments ?? []
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return experiments.filter((e) => {
      if (statusFilter !== 'all' && e.frontMatter.status !== statusFilter) return false
      if (!needle) return true
      const fields = [
        e.id,
        e.frontMatter.name,
        ...e.frontMatter.tags,
        ...e.frontMatter.hypotheses,
      ]
      return fields.some((f) => f.toLowerCase().includes(needle))
    })
  }, [experiments, search, statusFilter])

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="filter by id / name / tag / hypothesis…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 flex-1 min-w-[12rem] rounded-md border border-slate-300 bg-white px-3 text-sm placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"
        >
          <option value="all">all status</option>
          {STATUS_VALUES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-500">
          {filtered.length} / {experiments.length}
        </span>
        <div className="ml-auto">
          <NewExperimentButton project={project} />
        </div>
      </div>

      {isLoading && experiments.length === 0 && <ListSkeleton count={6} />}
      {error && <div className="text-sm text-red-600">error: {(error as Error).message}</div>}

      <div className="hidden grid-cols-12 items-center gap-3 border-b border-slate-200 pb-2 text-xs uppercase tracking-wide text-slate-500 md:grid">
        <div className="col-span-2">status</div>
        <div className="col-span-3">id</div>
        <div className="col-span-2">name</div>
        <div className="col-span-2">created</div>
        <div className="col-span-1">tags</div>
        <div className="col-span-2">hypotheses</div>
      </div>
      <div className="flex flex-col gap-2">
        {filtered.map((e) => (
          <ExperimentRow key={e.id} project={project} exp={e} />
        ))}
        {filtered.length === 0 && !isLoading && (
          <div className="rounded-md border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
            no experiments match
          </div>
        )}
      </div>
    </div>
  )
}

function ExperimentRow({ project, exp }: { project: string; exp: IndexedExperiment }) {
  const noReadme = !exp.hasReadme
  return (
    <Link
      href={`/p/${encodeURIComponent(project)}/experiments/${encodeURIComponent(exp.id)}`}
      className="block"
    >
      <Card
        className={
          'transition hover:border-slate-400 ' +
          (noReadme ? 'opacity-60' : '')
        }
      >
        <div className="grid grid-cols-1 gap-2 p-3 md:grid-cols-12 md:items-center md:gap-3">
          <div className="md:col-span-2">
            <StatusPill status={exp.frontMatter.status} stale={exp.stale} />
          </div>
          <div className="font-mono text-sm md:col-span-3 truncate">{exp.id}</div>
          <div className="text-sm md:col-span-2 truncate">{exp.frontMatter.name}</div>
          <div className="md:col-span-2">
            <TimestampLocal value={exp.frontMatter.createdAt} />
          </div>
          <div className="flex flex-wrap gap-1 md:col-span-1">
            {exp.frontMatter.tags.map((t) => (
              <Badge key={t} variant="outline">
                {t}
              </Badge>
            ))}
          </div>
          <div className="flex flex-wrap gap-1 md:col-span-2">
            {exp.frontMatter.hypotheses.map((h) => (
              <Badge key={h}>{h}</Badge>
            ))}
            {noReadme && <Badge variant="warning">no README</Badge>}
          </div>
        </div>
      </Card>
    </Link>
  )
}
