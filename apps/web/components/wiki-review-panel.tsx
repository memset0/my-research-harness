'use client'

// Owner-only wiki review surface.
//
// Two dialogs, both built from the machinery the Git history dialog already
// uses (`fetchGitCommit` + `<FileRow />`), scoped to `docs/wiki/`:
//   - <WikiReviewPanel>  : the commit log with "Verify next" / "Unverify"
//   - <WikiChangesDialog>: one page's diff from `verifiedThrough` to the
//                          working tree, opened from the reading pane badge.
//
// Marks are strictly sequential, so no per-row verify action is offered: the
// only forward move is the oldest unverified commit.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, GitCommitVertical, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { WikiReview } from '@memon/core'
import {
  fetchGitCommit,
  fetchWikiReview,
  markWikiReview,
  type ProjectTarget,
  projectHost,
  projectQueryKey,
  projectWebPath,
  unmarkWikiReview,
} from '../lib/api'
import { formatRelativeTime } from '../lib/format-relative-time'
import { cn } from '../lib/utils'
import { FileRow } from './file-row'
import { ListSkeleton } from './skeletons'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'

const WIKI_PATH_PREFIX = 'docs/wiki/'

export function WikiReviewPanel({
  project,
  open,
  onOpenChange,
}: {
  project: ProjectTarget
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-slot="wiki-review-panel"
        className="flex max-h-[90vh] w-[min(92vw,1100px)] max-w-none flex-col gap-3 sm:max-w-none"
      >
        <DialogHeader className="space-y-1">
          <DialogTitle className="font-mono text-base">
            <span className="text-muted-foreground">wiki review — </span>
            {typeof project === 'string' ? project : `${project.host}/${project.project}`}
          </DialogTitle>
          <DialogDescription>
            Wiki commits oldest first. Verification is sequential: only the oldest unverified commit
            can be marked, and unverifying one cascades to every newer mark.
          </DialogDescription>
        </DialogHeader>
        {open && <WikiReviewBody project={project} />}
      </DialogContent>
    </Dialog>
  )
}

function WikiReviewBody({ project }: { project: ProjectTarget }) {
  const queryClient = useQueryClient()
  const reviewKey = useMemo(() => ['wiki-review', ...projectQueryKey(project)], [project])
  const log = useQuery({
    queryKey: reviewKey,
    queryFn: () => fetchWikiReview(project),
    retry: false,
  })
  const [previewSha, setPreviewSha] = useState<string | null>(null)

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: reviewKey })
    queryClient.invalidateQueries({ queryKey: ['wiki', ...projectQueryKey(project)] })
  }

  const verify = useMutation({
    mutationFn: (sha: string) => markWikiReview(project, sha),
    onSuccess: () => {
      setPreviewSha(null)
      invalidate()
      toast.success('commit verified')
    },
    onError: (error: Error & { status?: number }) => {
      toast.error(
        error.status === 409
          ? 'Verification is sequential — reload the panel and verify the oldest unverified commit.'
          : `verify failed: ${error.message}`,
      )
    },
  })
  const unverify = useMutation({
    mutationFn: (sha: string) => unmarkWikiReview(project, sha),
    onSuccess: () => {
      invalidate()
      toast.success('mark removed')
    },
    onError: (error: Error) => toast.error(`unverify failed: ${error.message}`),
  })

  if (log.isLoading && !log.data) return <ListSkeleton count={5} />
  if (log.error) {
    return (
      <p className="p-4 text-sm text-destructive" data-slot="wiki-review-error">
        error: {(log.error as Error).message}
      </p>
    )
  }

  const commits = log.data?.commits ?? []
  const nextUnverified = commits.find((commit) => !commit.verified) ?? null
  const inFlight = verify.isPending || unverify.isPending

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">verified through</span>
        <span className="font-mono" data-slot="wiki-review-verified-through">
          {log.data?.verifiedThrough ? log.data.verifiedThrough.slice(0, 8) : '—'}
        </span>
        <Button
          type="button"
          size="sm"
          className="ml-auto"
          data-slot="wiki-review-verify-next"
          disabled={!nextUnverified || inFlight}
          onClick={() => nextUnverified && setPreviewSha(nextUnverified.sha)}
        >
          <ShieldCheck className="size-3.5" />
          {nextUnverified ? `Verify next (${nextUnverified.sha.slice(0, 8)})` : 'All verified'}
        </Button>
      </div>

      {previewSha && (
        <VerifyNextPreview
          project={project}
          sha={previewSha}
          pending={verify.isPending}
          onCancel={() => setPreviewSha(null)}
          onConfirm={() => verify.mutate(previewSha)}
        />
      )}

      <ul
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1"
        data-slot="wiki-review-commits"
      >
        {commits.length === 0 ? (
          <li className="px-3 py-6 text-center text-xs text-muted-foreground">
            no wiki commits yet
          </li>
        ) : (
          commits.map((commit) => {
            const newerMarks = commits.filter(
              (other) => other.verified && commits.indexOf(other) > commits.indexOf(commit),
            ).length
            return (
              <li
                key={commit.sha}
                data-slot="wiki-review-commit"
                data-sha={commit.sha}
                data-verified={commit.verified}
                className="flex flex-wrap items-center gap-2 border-b px-1 py-2 text-xs last:border-b-0"
              >
                <span
                  className={cn(
                    'inline-flex size-4 shrink-0 items-center justify-center rounded-full border',
                    commit.verified
                      ? 'border-primary/50 bg-primary/10 text-primary'
                      : 'border-muted-foreground/30 text-transparent',
                  )}
                  title={
                    commit.verified ? `verified ${commit.verifiedAt ?? ''}`.trim() : 'not verified'
                  }
                >
                  <Check className="size-3" aria-hidden />
                  <span className="sr-only">{commit.verified ? 'verified' : 'not verified'}</span>
                </span>
                <span className="shrink-0 font-mono tabular-nums">{commit.sha.slice(0, 8)}</span>
                <span className="shrink-0 text-muted-foreground" title={commit.authoredAt}>
                  {formatRelativeTime(commit.authoredAt)}
                </span>
                <span className="min-w-0 flex-1 truncate">{commit.subject}</span>
                <span className="flex shrink-0 flex-wrap items-center gap-1">
                  {commit.pages.map((pageId) => (
                    <Link
                      key={pageId}
                      href={projectWebPath(project, `/wiki/${encodeURIComponent(pageId)}`)}
                      className="rounded bg-muted px-1 font-mono text-[10px] hover:bg-accent"
                    >
                      {pageId}
                    </Link>
                  ))}
                </span>
                {commit.verified && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 shrink-0 px-2 text-[11px]"
                    data-slot="wiki-review-unverify"
                    disabled={inFlight}
                    onClick={() => {
                      const message =
                        newerMarks > 0
                          ? `Unverifying ${commit.sha.slice(0, 8)} also removes ${newerMarks} newer mark(s). Continue?`
                          : `Remove the verification mark on ${commit.sha.slice(0, 8)}?`
                      if (typeof window !== 'undefined' && !window.confirm(message)) return
                      unverify.mutate(commit.sha)
                    }}
                  >
                    Unverify
                  </Button>
                )}
              </li>
            )
          })
        )}
      </ul>
    </div>
  )
}

function VerifyNextPreview({
  project,
  sha,
  pending,
  onCancel,
  onConfirm,
}: {
  project: ProjectTarget
  sha: string
  pending: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="rounded-md border bg-muted/30 p-2" data-slot="wiki-review-preview">
      <div className="flex items-center gap-2 text-xs">
        <GitCommitVertical className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="font-mono">{sha.slice(0, 8)}</span>
        <span className="text-muted-foreground">changes under docs/wiki/</span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={onConfirm} disabled={pending}>
            {pending ? 'Verifying…' : 'Confirm verify'}
          </Button>
        </div>
      </div>
      <div className="mt-2 max-h-64 overflow-y-auto overflow-x-hidden">
        <WikiCommitFiles project={project} sha={sha} />
      </div>
    </div>
  )
}

function WikiCommitFiles({ project, sha }: { project: ProjectTarget; sha: string }) {
  // The Git routes are standalone-only (the history dialog is likewise hidden
  // for Host-qualified Projects), so the diff preview degrades to the file
  // list carried by the review log rather than pretending to fetch it.
  const enabled = projectHost(project) === null
  const detail = useQuery({
    queryKey: ['git-commit', ...projectQueryKey(project), sha],
    queryFn: () => fetchGitCommit(project, sha),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })

  if (!enabled) {
    return (
      <p className="px-1 text-[11px] text-muted-foreground">
        diff preview is available on the Host that owns the repository
      </p>
    )
  }
  if (detail.isLoading) return <ListSkeleton count={2} />
  if (detail.error) {
    return <p className="px-1 text-[11px] text-destructive">{(detail.error as Error).message}</p>
  }
  if (!detail.data || detail.data.enabled === false) {
    return <p className="px-1 text-[11px] text-muted-foreground">no diff available</p>
  }
  const files = detail.data.files.filter((file) => file.path.startsWith(WIKI_PATH_PREFIX))
  if (files.length === 0) {
    return <p className="px-1 text-[11px] text-muted-foreground">no docs/wiki/ files in commit</p>
  }
  return (
    <div className="flex flex-col">
      {files.map((file) => (
        <FileRow key={file.path} project={project} side="commit" sha={sha} entry={file} />
      ))}
    </div>
  )
}

/** One page's diff from the last verified wiki commit to the working tree. */
export function WikiChangesDialog({
  project,
  pageId,
  pagePath,
  review,
  open,
  onOpenChange,
}: {
  project: ProjectTarget
  pageId: string
  pagePath: string
  review: WikiReview
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const enabled = projectHost(project) === null && review.verifiedThrough !== null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-slot="wiki-changes-since-verify"
        className="flex max-h-[90vh] w-[min(92vw,1100px)] max-w-none flex-col gap-3 sm:max-w-none"
      >
        <DialogHeader className="space-y-1">
          <DialogTitle className="font-mono text-base">
            <span className="text-muted-foreground">changes since verification — </span>
            {pageId}
          </DialogTitle>
          <DialogDescription>
            {review.verifiedThrough
              ? `${pagePath} from ${review.verifiedThrough.slice(0, 8)} to the working tree.`
              : `${pagePath} has never been covered by a verified wiki commit.`}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          {!enabled ? (
            <p className="px-1 text-xs text-muted-foreground">
              diff is available on the Host that owns the repository
            </p>
          ) : (
            <div className="flex flex-col">
              <FileRow
                project={project}
                side="range"
                entry={{ path: pagePath, status: 'modified' }}
                range={{ from: review.verifiedThrough!, to: 'HEAD' }}
              />
              {review.dirty && (
                <FileRow
                  project={project}
                  side="unstaged"
                  entry={{ path: pagePath, status: 'modified' }}
                />
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
