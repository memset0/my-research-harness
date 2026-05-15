'use client'

// Detailed per-project git status, in a modal opened from the project-
// footer's git pill. Three sections: Staged / Unstaged / Untracked.
// Each file row collapsed by default; expanding lazily fetches the diff.

import { useQuery } from '@tanstack/react-query'
import { GitBranch } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Skeleton } from './ui/skeleton'
import { Button } from './ui/button'
import {
  fetchGitStatus,
  fetchGitStatusFiles,
  type GitDiffSide,
  type GitFileEntry,
} from '../lib/api'
import { useDiffViewMode } from '../lib/use-diff-view-mode'
import { FileRow } from './file-row'

export interface GitDiffDialogProps {
  project: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * When provided, the dialog renders a "View history" link in its header
   * that invokes this callback. Callers are responsible for closing the
   * status dialog and opening the history dialog (mutually exclusive).
   */
  onOpenHistory?: () => void
}

export function GitDiffDialog({
  project,
  open,
  onOpenChange,
  onOpenHistory,
}: GitDiffDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-slot="git-diff-dialog"
        className="flex max-h-[90vh] w-[min(90vw,1600px)] max-w-none flex-col gap-3 sm:max-w-none"
      >
        <DialogHeader className="space-y-1">
          <DialogTitle className="font-mono text-base">
            <span className="text-muted-foreground">git status — </span>
            {project}
            {onOpenHistory && (
              <button
                type="button"
                onClick={onOpenHistory}
                data-slot="git-diff-dialog-history-link"
                className="ml-3 cursor-pointer text-xs font-normal text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                View history
              </button>
            )}
          </DialogTitle>
          <DialogDescription asChild>
            <BranchSummary project={project} />
          </DialogDescription>
        </DialogHeader>
        <Toolbar />
        <div className="flex-1 overflow-auto">
          <Sections project={project} open={open} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function BranchSummary({ project }: { project: string }) {
  const { data } = useQuery({
    queryKey: ['git-status', project],
    queryFn: () => fetchGitStatus(project),
    staleTime: 5_000,
  })
  if (!data || data.enabled === false) {
    return (
      <span className="font-mono text-xs text-muted-foreground">
        not a git repository
      </span>
    )
  }
  const branchLabel = data.detached ? `(${data.sha})` : data.branch ?? '?'
  return (
    <span className="inline-flex items-center gap-2 font-mono text-xs text-muted-foreground">
      <GitBranch className="size-3.5 shrink-0" aria-hidden />
      <span>{branchLabel}</span>
      {data.upstream && <span>· {data.upstream}</span>}
      {data.ahead > 0 && <span>· ↑{data.ahead}</span>}
      {data.behind > 0 && <span>· ↓{data.behind}</span>}
      <span>· ●{data.staged}</span>
      <span>○{data.unstaged}</span>
      <span>?{data.untracked}</span>
    </span>
  )
}

function Toolbar() {
  const [mode, setMode] = useDiffViewMode()
  return (
    <div
      data-slot="git-diff-dialog-toolbar"
      className="flex items-center justify-end gap-2 border-b pb-2"
    >
      <span className="text-xs text-muted-foreground">view</span>
      <div className="inline-flex overflow-hidden rounded-md border">
        <Button
          variant={mode === 'split' ? 'default' : 'ghost'}
          size="sm"
          className="h-7 rounded-none px-2 text-xs"
          onClick={() => setMode('split')}
          aria-pressed={mode === 'split'}
          data-slot="view-mode-split"
        >
          split
        </Button>
        <Button
          variant={mode === 'inline' ? 'default' : 'ghost'}
          size="sm"
          className="h-7 rounded-none px-2 text-xs"
          onClick={() => setMode('inline')}
          aria-pressed={mode === 'inline'}
          data-slot="view-mode-inline"
        >
          inline
        </Button>
      </div>
    </div>
  )
}

function Sections({ project, open }: { project: string; open: boolean }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ['git-status-files', project],
    queryFn: () => fetchGitStatusFiles(project),
    enabled: open,
    staleTime: 2_000,
    retry: false,
  })

  if (isPending) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-6 w-2/5" />
      </div>
    )
  }
  if (isError || !data) {
    return (
      <p className="text-xs text-destructive">Failed to load file list.</p>
    )
  }
  if (data.enabled === false) {
    return (
      <p className="text-xs text-muted-foreground italic">
        {data.reason === 'not-a-repo'
          ? 'not a git repository'
          : `git unavailable: ${data.reason}`}
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <Section
        title="Staged"
        entries={data.staged}
        project={project}
        side="staged"
      />
      <Section
        title="Unstaged"
        entries={data.unstaged}
        project={project}
        side="unstaged"
      />
      <Section
        title="Untracked"
        entries={data.untracked}
        project={project}
        side="untracked"
      />
    </div>
  )
}

function Section({
  title,
  entries,
  project,
  side,
}: {
  title: string
  entries: GitFileEntry[]
  project: string
  side: GitDiffSide
}) {
  return (
    <section data-slot={`section-${side}`}>
      <h3 className="mb-1 font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title} ({entries.length})
      </h3>
      {entries.length === 0 ? (
        <p className="pl-2 text-xs text-muted-foreground italic">(none)</p>
      ) : (
        <ul className="space-y-0.5">
          {entries.map((entry) => (
            <li key={`${entry.path}:${entry.origPath ?? ''}`}>
              <FileRow project={project} side={side} entry={entry} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

