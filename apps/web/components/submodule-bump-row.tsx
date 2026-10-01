'use client'

// Specialised collapsible row for a main-repo commit's submodule-pointer
// bump. Rendered in place of `<FileRow />` when a `git diff-tree --raw`
// entry has `oldMode === newMode === 160000` AND the path matches a known
// submodule name. Expanding lazily fetches `fetchGitRange(project, from,
// to, submodule)` and lists the submodule's actual commits + per-file
// diffs between the two pinned SHAs.
//
// The verification mark stays on the OUTER main-repo commit (this row is
// purely a review aid — see openspec/changes/add-submodule-bump-diff).

import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { fetchGitRange, type GitFileEntry, type ProjectTarget, projectQueryKey } from '../lib/api'
import { queryKeys } from '../lib/query-keys'
import { cn } from '../lib/utils'
import { FileRow } from './file-row'

export interface SubmoduleBumpRowProps {
  project: ProjectTarget
  /** Submodule name from `.gitmodules` (e.g. `"vendor/foo"`). */
  submodule: string
  /** Main-repo path that mounts this submodule. */
  path: string
  fromSha: string
  toSha: string
}

function short(sha: string): string {
  return sha.slice(0, 7)
}

export function SubmoduleBumpRow({
  project,
  submodule,
  path,
  fromSha,
  toSha,
}: SubmoduleBumpRowProps) {
  const [expanded, setExpanded] = useState(false)
  const [hasBeenExpanded, setHasBeenExpanded] = useState(false)

  function onToggle() {
    setExpanded((prev) => {
      const next = !prev
      if (next && !hasBeenExpanded) setHasBeenExpanded(true)
      return next
    })
  }

  return (
    <div data-slot="submodule-bump-row">
      <button
        type="button"
        onClick={onToggle}
        data-slot="submodule-bump-row-trigger"
        data-expanded={expanded}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent hover:text-accent-foreground"
      >
        <ChevronRight
          className={cn('size-3.5 shrink-0 transition-transform', expanded && 'rotate-90')}
          aria-hidden
        />
        <span className="w-3 shrink-0 text-center font-mono font-semibold text-blue-600 dark:text-blue-400">
          S
        </span>
        <span className="truncate font-mono">{path}</span>
        <span className="shrink-0 text-muted-foreground">
          {short(fromSha)} → {short(toSha)}
        </span>
      </button>
      {hasBeenExpanded && (
        <div className={cn('pl-6', !expanded && 'hidden')}>
          <SubmoduleBumpBody
            project={project}
            submodule={submodule}
            fromSha={fromSha}
            toSha={toSha}
          />
        </div>
      )}
    </div>
  )
}

function SubmoduleBumpBody({
  project,
  submodule,
  fromSha,
  toSha,
}: {
  project: ProjectTarget
  submodule: string
  fromSha: string
  toSha: string
}) {
  const { data, isPending, isError, error } = useQuery({
    queryKey: queryKeys.gitRange(project, submodule, fromSha, toSha),
    queryFn: () => fetchGitRange(project, fromSha, toSha, submodule),
    staleTime: Infinity,
    retry: false,
  })

  if (isPending) {
    return (
      <p
        data-slot="submodule-bump-body-loading"
        className="px-2 py-1 text-xs text-muted-foreground italic"
      >
        loading…
      </p>
    )
  }

  if (isError || !data) {
    return (
      <p className="px-2 py-1 text-xs text-destructive">
        {(error as Error)?.message ?? 'failed to load submodule range'}
      </p>
    )
  }

  if (data.enabled === false) {
    return (
      <p className="px-2 py-1 text-xs text-muted-foreground italic">
        {data.reason === 'not-a-repo' ? 'submodule is not a git repo' : `git: ${data.reason}`}
      </p>
    )
  }

  return (
    <div className="space-y-2 py-1">
      <CommitsSummary commits={data.commits} />
      <FilesSection
        project={project}
        submodule={submodule}
        files={data.files}
        from={fromSha}
        to={toSha}
      />
    </div>
  )
}

function CommitsSummary({
  commits,
}: {
  commits: ReadonlyArray<{
    sha: string
    shortSha: string
    subject: string
    authorName: string
    authorDate: string
  }>
}) {
  return (
    <div data-slot="submodule-bump-commits" className="space-y-0.5">
      <h5 className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Commits ({commits.length})
      </h5>
      {commits.length === 0 ? (
        <p className="pl-2 text-xs text-muted-foreground italic">(none)</p>
      ) : (
        <ul className="space-y-0.5 pl-2">
          {commits.map((c) => (
            <li key={c.sha} className="flex gap-2 text-xs">
              <span className="shrink-0 font-mono text-muted-foreground">{c.shortSha}</span>
              <span className="truncate">{c.subject}</span>
              <span className="shrink-0 text-muted-foreground">{c.authorName}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function FilesSection({
  project,
  submodule,
  files,
  from,
  to,
}: {
  project: ProjectTarget
  submodule: string
  files: GitFileEntry[]
  from: string
  to: string
}) {
  return (
    <div data-slot="submodule-bump-files" className="space-y-0.5">
      <h5 className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Files ({files.length})
      </h5>
      {files.length === 0 ? (
        <p className="pl-2 text-xs text-muted-foreground italic">(none)</p>
      ) : (
        <ul className="space-y-0.5">
          {files.map((f) => (
            <li key={`${f.path}:${f.origPath ?? ''}`}>
              <FileRow
                project={project}
                side="range"
                submodule={submodule}
                range={{ from, to }}
                entry={f}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
