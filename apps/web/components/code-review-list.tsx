'use client'

import type { CodeReviewCompletion } from '@memon/core'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import {
  type CodeReviewListItem,
  fetchCodeReviews,
  type ProjectTarget,
  projectQueryKey,
  projectWebPath,
} from '../lib/api'
import { queryKeys } from '../lib/query-keys'
import { cn } from '../lib/utils'
import { SuccessBadge } from './colored-badge'
import { Badge } from './ui/badge'
import { Card } from './ui/card'

// Encode each path segment but keep the slashes so the catch-all route matches.
const encId = (id: string) => id.split('/').map(encodeURIComponent).join('/')

function CompletionBadge({ c }: { c: CodeReviewCompletion }) {
  if (c.isComplete) return <SuccessBadge>Complete</SuccessBadge>
  return (
    <Badge variant="outline" className="shrink-0 tabular-nums">
      {c.reviewedCommits}/{c.totalCommits} commits · {c.doneTodos}/{c.totalTodos} todos
    </Badge>
  )
}

export function CodeReviewList({ project }: { project: ProjectTarget }) {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.codeReviews(project),
    queryFn: () => fetchCodeReviews(project),
  })
  const items = data?.codeReviews ?? []

  if (isLoading && items.length === 0) {
    return <div className="p-6 text-sm text-muted-foreground">Loading code reviews…</div>
  }
  if (items.length === 0) {
    return (
      <div className="p-6 text-sm text-muted-foreground" data-slot="code-review-empty">
        No code reviews yet. They appear here once an agent writes one to
        <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">docs/code-review/</code>
        or an experiment&apos;s{' '}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">code-review/</code> folder.
      </div>
    )
  }

  const projectWide = items.filter((i) => !i.experiment)
  const byExp = new Map<string, CodeReviewListItem[]>()
  for (const i of items) {
    if (!i.experiment) continue
    const arr = byExp.get(i.experiment) ?? []
    arr.push(i)
    byExp.set(i.experiment, arr)
  }
  const expIds = Array.from(byExp.keys()).sort()

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-6" data-slot="code-review-list">
      <h1 className="text-lg font-semibold">Code reviews</h1>
      {projectWide.length > 0 && (
        <Group title="Project-wide" items={projectWide} project={project} />
      )}
      {expIds.map((eid) => (
        <Group key={eid} title={eid} items={byExp.get(eid)!} project={project} />
      ))}
    </div>
  )
}

function Group({
  title,
  items,
  project,
}: {
  title: string
  items: CodeReviewListItem[]
  project: ProjectTarget
}) {
  return (
    <section className="space-y-2" data-slot="code-review-group">
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
      <div className="space-y-2">
        {items.map((i) => (
          <Link
            key={i.id}
            href={projectWebPath(project, `/code-review/${encId(i.id)}`)}
            className="block"
            data-slot="code-review-row"
          >
            <Card
              size="sm"
              className={cn(
                'flex-row items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-accent',
              )}
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">
                  {i.title || i.id}
                </div>
                <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">{i.date}</div>
              </div>
              <CompletionBadge c={i.completion} />
            </Card>
          </Link>
        ))}
      </div>
    </section>
  )
}
