'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { fetchCodeReviews, type ProjectTarget, projectQueryKey, projectWebPath } from '../lib/api'
import { SuccessBadge } from './colored-badge'
import { Badge } from './ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'

// Associated-code-reviews panel for the experiment-doc detail page. Derives
// from the same ['code-reviews', project] cache the viewer uses (so it stays
// live via the code-reviews-change SSE topic) and filters to this experiment.
// Renders nothing when the experiment has no associated reviews.

const encId = (id: string) => id.split('/').map(encodeURIComponent).join('/')

export function ExperimentCodeReviews({
  project,
  experimentId,
}: {
  project: ProjectTarget
  experimentId: string
}) {
  const { data } = useQuery({
    queryKey: ['code-reviews', ...projectQueryKey(project)],
    queryFn: () => fetchCodeReviews(project),
    staleTime: 5_000,
  })
  const items = (data?.codeReviews ?? []).filter((i) => i.experiment === experimentId)
  if (items.length === 0) return null

  return (
    <Card data-slot="experiment-code-reviews">
      <CardHeader>
        <CardTitle>
          Code reviews{' '}
          <span className="text-sm font-normal text-muted-foreground">({items.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {items.map((i) => (
          <Link
            key={i.id}
            href={projectWebPath(project, `/code-review/${encId(i.id)}`)}
            className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
            data-slot="experiment-code-review-row"
          >
            <span className="min-w-0 truncate text-foreground">{i.title || i.id}</span>
            {i.completion.isComplete ? (
              <SuccessBadge>Complete</SuccessBadge>
            ) : (
              <Badge variant="outline" className="shrink-0 tabular-nums">
                {i.completion.reviewedCommits}/{i.completion.totalCommits} ·{' '}
                {i.completion.doneTodos}/{i.completion.totalTodos}
              </Badge>
            )}
          </Link>
        ))}
      </CardContent>
    </Card>
  )
}
