'use client'

// Collapsible per-file row used inside both `<GitDiffDialog />` and
// `<GitHistoryDialog />`. Default state collapsed; expanding lazily
// fetches the file's diff via `fetchGitDiff(project, path, side, opts?)`.
//
// Once expanded, the body stays MOUNTED for the dialog session (the visual
// state hides it but the TanStack observer survives), so a collapse +
// re-expand within the same dialog hits the cache instead of refiring.

import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import {
  fetchGitDiff,
  type GitDiffResponse,
  type GitDiffSide,
  type GitFileEntry,
  type GitFileStatus,
  type ProjectTarget,
  projectQueryKey,
} from '../lib/api'
import { cn } from '../lib/utils'
import { FileDiff, type FileDiffSkipReason } from './file-diff'

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

export interface FileRowProps {
  project: ProjectTarget
  side: GitDiffSide
  entry: GitFileEntry
  /** Required when `side === 'commit'`; ignored otherwise. */
  sha?: string
  /** When set, the per-file diff is scoped to the named submodule. */
  submodule?: string
  /** Required when `side === 'range'`; ignored otherwise. */
  range?: { from: string; to: string }
}

export function FileRow({ project, side, entry, sha, submodule, range }: FileRowProps) {
  const [expanded, setExpanded] = useState(false)
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
          className={cn('size-3.5 shrink-0 transition-transform', expanded && 'rotate-90')}
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
          <FileRowBody
            project={project}
            side={side}
            entry={entry}
            sha={sha}
            submodule={submodule}
            range={range}
          />
        </div>
      )}
    </div>
  )
}

export function FileRowBody({
  project,
  side,
  entry,
  sha,
  submodule,
  range,
}: {
  project: ProjectTarget
  side: GitDiffSide
  entry: GitFileEntry
  sha?: string
  submodule?: string
  range?: { from: string; to: string }
}) {
  // Cache key includes `sha` (commit-side), `submodule` (when scoped to a
  // submodule), and `range.from` / `range.to` (range side). Distinct cache
  // slots per (path, side, refs) tuple — same path can appear in different
  // repos and different commit windows during a single dialog session.
  const queryKey = [
    'git-diff',
    ...projectQueryKey(project),
    entry.path,
    side,
    sha,
    submodule,
    range?.from,
    range?.to,
  ] as const
  const { data, isPending, isError, error } = useQuery({
    queryKey,
    queryFn: () =>
      fetchGitDiff(project, entry.path, side, {
        sha,
        submodule,
        from: range?.from,
        to: range?.to,
      }),
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

  const message = 'error' in data && data.error?.message ? data.error.message : 'diff failed'
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
): { reason: FileDiffSkipReason; sizeBytes?: number; maxBytes?: number } | null {
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
