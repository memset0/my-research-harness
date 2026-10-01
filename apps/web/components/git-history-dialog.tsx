'use client'

// Per-project git history modal. Two-pane:
// - left: commit list (up to 100, newest-first) for the selected branch
// - right: selected commit's metadata + per-file diff list (reuses
//   `<FileRow />` from the working-tree dialog)
//
// Opens from two places: a footer icon button and a "View history" link in
// `<GitDiffDialog />`. The parent (project-footer) keeps the two dialogs
// mutually exclusive — only one open at a time.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { History, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  type CommitMark,
  fetchCommitMarks,
  fetchGitBranches,
  fetchGitCommit,
  fetchGitLog,
  fetchSubmodules,
  type GitBranches,
  type GitCommitDetail,
  type GitCommitSummary,
  type GitSubmoduleEntry,
} from '../lib/api'
import { formatRelativeTime } from '../lib/format-relative-time'
import { queryKeys } from '../lib/query-keys'
import { useDiffViewMode } from '../lib/use-diff-view-mode'
import { cn } from '../lib/utils'
import { CommitMarkBadge } from './commit-mark-badge'
import { CommitMarkEditor } from './commit-mark-editor'
import { FileRow } from './file-row'
import { SubmoduleBumpRow } from './submodule-bump-row'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Skeleton } from './ui/skeleton'

export interface GitHistoryDialogProps {
  project: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

const DETACHED_REF_PREFIX = '__detached__:'
/** Radix Select rejects an empty string value; use this sentinel for "main repo". */
const MAIN_REPO_SENTINEL = '__main__'

export function GitHistoryDialog({ project, open, onOpenChange }: GitHistoryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-slot="git-history-dialog"
        className="flex max-h-[90vh] w-[min(90vw,1600px)] max-w-none flex-col gap-3 sm:max-w-none"
      >
        <DialogHeader className="space-y-1">
          <DialogTitle className="font-mono text-base">
            <span className="text-muted-foreground">git history — </span>
            {project}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Browse commits and their per-file changes for {project}.
          </DialogDescription>
        </DialogHeader>
        {open && <HistoryBody project={project} />}
      </DialogContent>
    </Dialog>
  )
}

function HistoryBody({ project }: { project: string }) {
  const qc = useQueryClient()

  // Empty string = main repo. Set via the submodule selector.
  const [selectedSubmodule, setSelectedSubmodule] = useState<string>('')

  const submodulesQuery = useQuery({
    queryKey: queryKeys.submodules(project),
    queryFn: () => fetchSubmodules(project),
    staleTime: Infinity,
    retry: false,
  })

  const branchesQuery = useQuery({
    queryKey: queryKeys.gitBranches(project, selectedSubmodule),
    queryFn: () => fetchGitBranches(project, selectedSubmodule || undefined),
    staleTime: Infinity,
    retry: false,
  })

  const [selectedRef, setSelectedRef] = useState<string | null>(null)
  const [selectedSha, setSelectedSha] = useState<string | null>(null)

  // Derive the effective ref to fetch: explicit selection wins, otherwise
  // the current HEAD (branch name, or synthetic `__detached__:<sha>` when
  // HEAD is detached).
  const effectiveRef = useMemo(() => {
    if (selectedRef) return selectedRef
    const data = branchesQuery.data
    if (!data || data.enabled === false) return null
    if (data.detached) return `${DETACHED_REF_PREFIX}${data.sha}`
    return data.current
  }, [selectedRef, branchesQuery.data])

  // The actual git rev to send to /git-log: strip the synthetic prefix for
  // detached HEADs.
  const gitRev =
    effectiveRef && effectiveRef.startsWith(DETACHED_REF_PREFIX)
      ? effectiveRef.slice(DETACHED_REF_PREFIX.length)
      : effectiveRef

  const logQuery = useQuery({
    queryKey: queryKeys.gitLog(project, selectedSubmodule, gitRev),
    queryFn: () => fetchGitLog(project, gitRev!, 100, selectedSubmodule || undefined),
    enabled: Boolean(gitRev),
    staleTime: Infinity,
    retry: false,
  })

  // Per-project verification marks. Lazy on dialog open; the editor's
  // TanStack mutation invalidates this query so badges update inline.
  const marksQuery = useQuery({
    queryKey: queryKeys.commitMarks(project),
    queryFn: () => fetchCommitMarks(project),
    staleTime: Infinity,
    retry: false,
  })
  const marks: CommitMark[] = marksQuery.data?.marks ?? []

  function onRefresh() {
    qc.invalidateQueries({
      queryKey: queryKeys.gitBranches(project, selectedSubmodule),
    })
    if (gitRev) {
      qc.invalidateQueries({
        queryKey: queryKeys.gitLog(project, selectedSubmodule, gitRev),
      })
    }
  }

  // Track whether the currently-mounted CommitMarkEditor has a dirty
  // note draft. When the user clicks a DIFFERENT commit row, gate the
  // selection change behind a confirm prompt so unsaved drafts aren't
  // silently discarded. `pendingSha` holds the requested commit while the
  // AlertDialog asks for confirmation.
  const [editorDirty, setEditorDirty] = useState(false)
  const [pendingSha, setPendingSha] = useState<string | null>(null)

  function trySelect(nextSha: string) {
    if (editorDirty && selectedSha && selectedSha !== nextSha) {
      setPendingSha(nextSha)
      return
    }
    setSelectedSha(nextSha)
  }

  return (
    <>
      <Toolbar
        submodules={submodulesQuery.data}
        selectedSubmodule={selectedSubmodule}
        onSelectedSubmoduleChange={(next) => {
          setSelectedSubmodule(next)
          setSelectedRef(null)
          setSelectedSha(null)
        }}
        branches={branchesQuery.data}
        selectedRef={effectiveRef}
        onSelectedRefChange={(next) => {
          setSelectedRef(next)
          setSelectedSha(null)
        }}
        onRefresh={onRefresh}
      />
      <div className="flex min-h-0 flex-1 gap-3 sm:flex-row flex-col">
        <CommitList
          project={project}
          query={logQuery}
          selectedSha={selectedSha}
          onSelect={trySelect}
          marks={marks}
          submodule={selectedSubmodule}
        />
        <CommitDetail
          project={project}
          sha={selectedSha}
          marks={marks}
          submodule={selectedSubmodule}
          submodules={submodulesQuery.data}
          onDirtyChange={setEditorDirty}
        />
      </div>
      <AlertDialog
        open={pendingSha !== null}
        onOpenChange={(open) => {
          if (!open) setPendingSha(null)
        }}
      >
        <AlertDialogContent data-git-history-discard-confirm="">
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved note?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved note changes. Discard them and switch commits?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (pendingSha) setSelectedSha(pendingSha)
                setPendingSha(null)
              }}
            >
              Discard and switch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function Toolbar({
  submodules,
  selectedSubmodule,
  onSelectedSubmoduleChange,
  branches,
  selectedRef,
  onSelectedRefChange,
  onRefresh,
}: {
  submodules: import('../lib/api').GitSubmodules | undefined
  selectedSubmodule: string
  onSelectedSubmoduleChange: (s: string) => void
  branches: GitBranches | undefined
  selectedRef: string | null
  onSelectedRefChange: (ref: string) => void
  onRefresh: () => void
}) {
  const [mode, setMode] = useDiffViewMode()

  const items: { value: string; label: string; isCurrent: boolean }[] = []
  if (branches && branches.enabled === true) {
    if (branches.detached) {
      items.push({
        value: `${DETACHED_REF_PREFIX}${branches.sha}`,
        label: `(detached @ ${branches.sha})`,
        isCurrent: true,
      })
    }
    for (const b of branches.branches) {
      items.push({
        value: b.name,
        label: b.name + (b.isCurrent ? ' ★' : ''),
        isCurrent: b.isCurrent,
      })
    }
  }

  const submoduleItems: { value: string; label: string }[] = [
    { value: MAIN_REPO_SENTINEL, label: 'main' },
  ]
  if (submodules && submodules.enabled === true) {
    for (const s of submodules.submodules) {
      submoduleItems.push({ value: s.name, label: s.name })
    }
  }

  return (
    <div className="flex items-center gap-2 border-b pb-2">
      <Select
        value={selectedSubmodule || MAIN_REPO_SENTINEL}
        onValueChange={(next) => onSelectedSubmoduleChange(next === MAIN_REPO_SENTINEL ? '' : next)}
      >
        <SelectTrigger data-slot="git-history-submodule-select" className="h-7 w-[12rem] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {submoduleItems.map((it) => (
            <SelectItem key={it.value} value={it.value}>
              <span className="font-mono text-xs">{it.label}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={selectedRef ?? undefined} onValueChange={onSelectedRefChange}>
        <SelectTrigger data-slot="git-history-branch-select" className="h-7 w-[14rem] text-xs">
          <SelectValue placeholder="Loading branches…" />
        </SelectTrigger>
        <SelectContent>
          {items.map((it) => (
            <SelectItem key={it.value} value={it.value}>
              <span className="font-mono text-xs">{it.label}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        onClick={onRefresh}
        data-slot="git-history-refresh"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        aria-label="Refresh"
      >
        <RefreshCw className="size-3.5" aria-hidden />
      </Button>
      <div className="ml-auto inline-flex items-center gap-2 text-xs text-muted-foreground">
        view
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
    </div>
  )
}

function CommitList({
  project: _project,
  query,
  selectedSha,
  onSelect,
  marks,
  submodule,
}: {
  project: string
  query: ReturnType<typeof useQuery<unknown, Error>> & {
    data?: import('../lib/api').GitLog | undefined
  }
  selectedSha: string | null
  onSelect: (sha: string) => void
  marks: CommitMark[]
  submodule: string
}) {
  const { data, isPending, isError } = query as {
    data: import('../lib/api').GitLog | undefined
    isPending: boolean
    isError: boolean
  }

  return (
    <section
      data-slot="commit-list"
      className="flex w-full shrink-0 flex-col gap-1 overflow-auto sm:w-[35%] sm:max-w-[28rem]"
    >
      <h3 className="px-2 pb-1 font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Commits
      </h3>
      {isPending ? (
        <ListSkeleton />
      ) : isError || !data ? (
        <p className="px-2 text-xs text-destructive">Failed to load commits.</p>
      ) : data.enabled === false ? (
        <p className="px-2 text-xs text-muted-foreground italic">
          {data.reason === 'not-a-repo'
            ? 'not a git repository'
            : `git unavailable: ${data.reason}`}
        </p>
      ) : data.commits.length === 0 ? (
        <p className="px-2 text-xs text-muted-foreground italic">(no commits)</p>
      ) : (
        <ul className="space-y-0">
          {data.commits.map((c) => (
            <li key={c.sha}>
              <CommitRow
                commit={c}
                selected={c.sha === selectedSha}
                onSelect={() => onSelect(c.sha)}
                mark={marks.find((m) => m.sha === c.sha && m.submodule === submodule)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function CommitRow({
  commit,
  selected,
  onSelect,
  mark,
}: {
  commit: GitCommitSummary
  selected: boolean
  onSelect: () => void
  mark?: CommitMark
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      data-slot="commit-row"
      data-selected={selected}
      className={cn(
        'flex w-full flex-col items-start gap-0.5 rounded px-2 py-1 text-left text-xs hover:bg-accent hover:text-accent-foreground',
        selected && 'bg-accent text-accent-foreground',
      )}
      title={commit.authorDate}
    >
      <span className="flex w-full items-center gap-2">
        <CommitMarkBadge mark={mark} />
        <span className="font-mono text-muted-foreground">{commit.shortSha}</span>
        <span className="truncate font-medium">{commit.subject}</span>
      </span>
      <span className="flex w-full items-center gap-2 text-[10px] text-muted-foreground">
        <span className="truncate">{commit.authorName}</span>
        <span aria-hidden>·</span>
        <span>{formatRelativeTime(commit.authorDate)}</span>
      </span>
    </button>
  )
}

function ListSkeleton() {
  return (
    <div className="space-y-1 px-2">
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-4/5" />
    </div>
  )
}

function CommitDetail({
  project,
  sha,
  marks,
  submodule,
  submodules,
  onDirtyChange,
}: {
  project: string
  sha: string | null
  marks: CommitMark[]
  submodule: string
  submodules: import('../lib/api').GitSubmodules | undefined
  onDirtyChange: (dirty: boolean) => void
}) {
  const { data, isPending, isError } = useQuery({
    queryKey: queryKeys.gitCommit(project, submodule, sha),
    queryFn: () => fetchGitCommit(project, sha!, submodule || undefined),
    enabled: Boolean(sha),
    staleTime: Infinity,
    retry: false,
  })

  if (!sha) {
    return (
      <section
        data-slot="commit-detail"
        className="flex flex-1 items-center justify-center text-xs text-muted-foreground italic"
      >
        Select a commit to view its changes
      </section>
    )
  }

  return (
    <section data-slot="commit-detail" className="flex-1 overflow-auto">
      {isPending ? (
        <div className="space-y-2 px-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="mt-3 h-6 w-full" />
          <Skeleton className="h-6 w-full" />
        </div>
      ) : isError || !data ? (
        <p className="px-2 text-xs text-destructive">Failed to load commit.</p>
      ) : data.enabled === false ? (
        <p className="px-2 text-xs text-muted-foreground italic">
          {data.reason === 'not-found' ? 'commit not found' : `git: ${data.reason}`}
        </p>
      ) : (
        <CommitDetailBody
          project={project}
          detail={data}
          sha={data.sha}
          submodule={submodule}
          submodules={submodules}
          mark={marks.find((m) => m.sha === data.sha && m.submodule === submodule)}
          onDirtyChange={onDirtyChange}
        />
      )}
    </section>
  )
}

function CommitDetailBody({
  project,
  detail,
  sha,
  submodule,
  submodules,
  mark,
  onDirtyChange,
}: {
  project: string
  detail: Extract<GitCommitDetail, { enabled: true }>
  sha: string
  submodule: string
  submodules: import('../lib/api').GitSubmodules | undefined
  mark?: CommitMark
  onDirtyChange: (dirty: boolean) => void
}) {
  // Submodule-bump entries only apply when viewing the MAIN repo's history;
  // a submodule's own history wouldn't contain its own pointer changes.
  // Build a path→name map for O(1) per-file lookup.
  const submodulePathToName = new Map<string, string>()
  if (!submodule && submodules && submodules.enabled === true) {
    for (const s of submodules.submodules) {
      submodulePathToName.set(s.path, s.name)
    }
  }
  return (
    <div className="space-y-3">
      <header className="space-y-2 border-b pb-2 text-xs">
        <div className="font-mono text-muted-foreground">{detail.sha}</div>
        <div>
          <span className="font-medium">{detail.authorName}</span>{' '}
          <span className="text-muted-foreground">&lt;{detail.authorEmail}&gt;</span>{' '}
          <span className="text-muted-foreground">· {detail.authorDate}</span>
        </div>
        <CommitMarkEditor
          project={project}
          sha={sha}
          mark={mark}
          submodule={submodule || undefined}
          onDirtyChange={onDirtyChange}
        />
        <div className="font-medium">{detail.subject}</div>
        {detail.body && (
          <pre className="whitespace-pre-wrap text-xs text-muted-foreground">{detail.body}</pre>
        )}
      </header>
      <h4 className="font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Files ({detail.files.length})
      </h4>
      {detail.files.length === 0 ? (
        <p className="pl-2 text-xs text-muted-foreground italic">(none)</p>
      ) : (
        <ul className="space-y-0.5">
          {detail.files.map((f) => {
            const bumpName = f.submoduleBump ? submodulePathToName.get(f.path) : undefined
            if (f.submoduleBump && bumpName) {
              return (
                <li key={`${f.path}:bump`}>
                  <SubmoduleBumpRow
                    project={project}
                    submodule={bumpName}
                    path={f.path}
                    fromSha={f.submoduleBump.fromSha}
                    toSha={f.submoduleBump.toSha}
                  />
                </li>
              )
            }
            return (
              <li key={`${f.path}:${f.origPath ?? ''}`}>
                <FileRow
                  project={project}
                  side="commit"
                  sha={sha}
                  submodule={submodule || undefined}
                  entry={f}
                />
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
