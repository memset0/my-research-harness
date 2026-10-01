'use client'

import type { CodeReviewFrontMatter } from '@memon/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import {
  type CodeReviewProgressPatch,
  type FullCodeReview,
  fetchCodeReview,
  type ProjectTarget,
  patchCodeReviewProgress,
  projectQueryKey,
} from '../lib/api'
import { queryKeys } from '../lib/query-keys'
import { cn } from '../lib/utils'
import { SuccessBadge } from './colored-badge'
import { Markdown } from './markdown'
import { Badge } from './ui/badge'
import { Card } from './ui/card'
import { Checkbox } from './ui/checkbox'
import { Separator } from './ui/separator'

// Mirror of core's deriveCompletion (the client can't import @memon/core JS).
function counts(fm: CodeReviewFrontMatter) {
  const totalCommits = fm.commits.length
  const reviewedCommits = fm.commits.filter((c) => c.reviewed).length
  const totalTodos = fm.reviewTodolist.length
  const doneTodos = fm.reviewTodolist.filter((t) => t.done).length
  const isComplete =
    totalCommits + totalTodos > 0 && reviewedCommits === totalCommits && doneTodos === totalTodos
  return { totalCommits, reviewedCommits, totalTodos, doneTodos, isComplete }
}

export function CodeReviewDetail({ project, id }: { project: ProjectTarget; id: string }) {
  const qc = useQueryClient()
  const key = queryKeys.codeReview(project, id)
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => fetchCodeReview(project, id),
  })

  const mutation = useMutation({
    mutationFn: (patch: CodeReviewProgressPatch) => patchCodeReviewProgress(project, id, patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<FullCodeReview>(key)
      qc.setQueryData<FullCodeReview>(key, (old) => {
        if (!old) return old
        const next = structuredClone(old)
        if (patch.op === 'commit') {
          const c = next.frontmatter.commits.find((x) => x.sha === patch.sha)
          if (c) c.reviewed = patch.reviewed
        } else {
          const t = next.frontmatter.reviewTodolist[patch.index]
          if (t) t.done = patch.done
        }
        return next
      })
      return { prev }
    },
    onError: (_e, _patch, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev)
      toast.error('Could not save — the file changed on disk. Reloaded the latest.')
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key })
      qc.invalidateQueries({ queryKey: queryKeys.codeReviews(project) })
    },
  })

  if (isLoading && !data) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>
  }
  if (!data) {
    return <div className="p-6 text-sm text-muted-foreground">Code review not found.</div>
  }

  const fm = data.frontmatter
  const c = counts(fm)
  const pending = mutation.isPending

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-6" data-slot="code-review-detail">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold text-foreground">{fm.title || id}</h1>
          {c.isComplete ? (
            <SuccessBadge>Complete</SuccessBadge>
          ) : (
            <Badge variant="outline" className="tabular-nums">
              {c.reviewedCommits}/{c.totalCommits} commits · {c.doneTodos}/{c.totalTodos} todos
            </Badge>
          )}
        </div>
        {fm.description && <p className="text-sm text-muted-foreground">{fm.description}</p>}
        {data.experiment && (
          <p className="text-xs text-muted-foreground">
            Experiment: <span className="font-mono">{data.experiment}</span>
          </p>
        )}
      </header>

      <Card className="gap-3 p-4" data-slot="commit-checklist">
        <h2 className="text-sm font-medium text-foreground">Commits</h2>
        {fm.commits.length === 0 ? (
          <p className="text-xs text-muted-foreground">No commits.</p>
        ) : (
          <ul className="space-y-2">
            {fm.commits.map((commit) => (
              <li key={commit.sha} className="flex items-start gap-3">
                <Checkbox
                  checked={commit.reviewed}
                  disabled={pending}
                  onCheckedChange={(v) =>
                    mutation.mutate({
                      op: 'commit',
                      sha: commit.sha,
                      reviewed: v === true,
                      expectedMtime: data.mtime,
                      expectedHash: data.hash,
                    })
                  }
                  aria-label={`Mark commit ${commit.sha} reviewed`}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-foreground">
                    {commit.subject || commit.sha.slice(0, 12)}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono">{commit.repo}</span>
                    <a
                      href={commit.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-mono hover:text-foreground hover:underline"
                    >
                      {commit.sha.slice(0, 7)}
                      <ExternalLink className="size-3" />
                    </a>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="gap-3 p-4" data-slot="review-todolist">
        <h2 className="text-sm font-medium text-foreground">Review checklist</h2>
        {fm.reviewTodolist.length === 0 ? (
          <p className="text-xs text-muted-foreground">No checklist items.</p>
        ) : (
          <ul className="space-y-2">
            {fm.reviewTodolist.map((todo, idx) => (
              <li key={`${todo.item}:${todo.done}`} className="flex items-start gap-3">
                <Checkbox
                  checked={todo.done}
                  disabled={pending}
                  onCheckedChange={(v) =>
                    mutation.mutate({
                      op: 'todo',
                      index: idx,
                      done: v === true,
                      expectedMtime: data.mtime,
                      expectedHash: data.hash,
                    })
                  }
                  aria-label={`Mark checklist item ${idx + 1} done`}
                  className="mt-0.5"
                />
                <span className={cn('text-sm', todo.done && 'text-muted-foreground line-through')}>
                  {todo.item}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Separator />

      <Markdown className="min-w-0" project={project}>
        {data.body}
      </Markdown>
    </div>
  )
}
