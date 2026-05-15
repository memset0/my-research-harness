'use client'

// Detailed per-project git status, in a modal opened from the project-
// footer's git pill. Three sections: Staged / Unstaged / Untracked.
// Each file row collapsed by default; expanding lazily fetches the diff.

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, GitBranch } from 'lucide-react'
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
  fetchGitDiff,
  fetchGitStatus,
  fetchGitStatusFiles,
  type GitDiffResponse,
  type GitDiffSide,
  type GitFileEntry,
  type GitFileStatus,
} from '../lib/api'
import { useDiffViewMode } from '../lib/use-diff-view-mode'
import { FileDiff, type FileDiffSkipReason } from './file-diff'
import { cn } from '../lib/utils'

export interface GitDiffDialogProps {
  project: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

const STATUS_LABEL: Record<GitFileStatus, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  untracked: '?',
  conflict: '!',
  typechange: 'T',
}

const STATUS_COLOR: Record<GitFileStatus, string> = {
  added: 'text-primary',
  modified: 'text-amber-600 dark:text-amber-400',
  deleted: 'text-destructive',
  renamed: 'text-amber-600 dark:text-amber-400',
  copied: 'text-amber-600 dark:text-amber-400',
  untracked: 'text-muted-foreground',
  conflict: 'text-destructive',
  typechange: 'text-muted-foreground',
}

export function GitDiffDialog({ project, open, onOpenChange }: GitDiffDialogProps) {
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

function FileRow({
  project,
  side,
  entry,
}: {
  project: string
  side: GitDiffSide
  entry: GitFileEntry
}) {
  const [expanded, setExpanded] = useState(false)
  // Once the user expands the row, we keep `<FileRowBody />` MOUNTED for the
  // dialog session — collapsing only hides it visually. This preserves the
  // TanStack query observer so re-expanding hits the cache rather than
  // refiring `fetchGitDiff`.
  const [hasBeenExpanded, setHasBeenExpanded] = useState(false)
  const code = STATUS_LABEL[entry.status]
  const colorCls = STATUS_COLOR[entry.status]

  function onToggle() {
    setExpanded((prev) => {
      const next = !prev
      if (next && !hasBeenExpanded) setHasBeenExpanded(true)
      return next
    })
  }

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        data-slot="file-row-trigger"
        data-expanded={expanded}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent hover:text-accent-foreground"
      >
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 transition-transform',
            expanded && 'rotate-90',
          )}
          aria-hidden
        />
        <span className={cn('w-3 shrink-0 text-center font-mono font-semibold', colorCls)}>
          {code}
        </span>
        <span className="truncate font-mono">
          {entry.origPath ? `${entry.origPath} → ${entry.path}` : entry.path}
        </span>
      </button>
      {hasBeenExpanded && (
        <div className={cn('pl-6', !expanded && 'hidden')}>
          <FileRowBody project={project} side={side} entry={entry} />
        </div>
      )}
    </div>
  )
}

function FileRowBody({
  project,
  side,
  entry,
}: {
  project: string
  side: GitDiffSide
  entry: GitFileEntry
}) {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['git-diff', project, entry.path, side],
    queryFn: () => fetchGitDiff(project, entry.path, side),
    staleTime: Infinity,
    retry: false,
  })

  if (isPending) {
    return (
      <FileDiff
        filename={entry.path}
        oldFilename={entry.origPath}
        status={entry.status}
        oldContent={null}
        newContent={null}
        loading
      />
    )
  }
  if (isError || !data) {
    return (
      <FileDiff
        filename={entry.path}
        oldFilename={entry.origPath}
        status={entry.status}
        oldContent={null}
        newContent={null}
        errorMessage={(error as Error)?.message ?? 'failed to load diff'}
      />
    )
  }

  const skip = extractSkipReason(data)
  if (skip) {
    return (
      <FileDiff
        filename={entry.path}
        oldFilename={entry.origPath}
        status={entry.status}
        oldContent={null}
        newContent={null}
        skipReason={skip.reason}
        skipSizeBytes={skip.sizeBytes}
        skipMaxBytes={skip.maxBytes}
      />
    )
  }

  if ('ok' in data && data.ok) {
    return (
      <FileDiff
        filename={data.filename}
        oldFilename={entry.origPath}
        status={data.status}
        oldContent={data.oldContent}
        newContent={data.newContent}
      />
    )
  }

  // ok: false with `error` field — fallback to error UI.
  const message =
    'error' in data && data.error?.message ? data.error.message : 'diff failed'
  return (
    <FileDiff
      filename={entry.path}
      oldFilename={entry.origPath}
      status={entry.status}
      oldContent={null}
      newContent={null}
      errorMessage={message}
    />
  )
}

function extractSkipReason(
  data: GitDiffResponse,
):
  | { reason: FileDiffSkipReason; sizeBytes?: number; maxBytes?: number }
  | null {
  if ('ok' in data && data.ok === false && 'skipReason' in data) {
    if (data.skipReason === 'too-large') {
      return {
        reason: 'too-large',
        sizeBytes: data.sizeBytes,
        maxBytes: data.maxBytes,
      }
    }
    if (data.skipReason === 'binary') return { reason: 'binary' }
  }
  return null
}
