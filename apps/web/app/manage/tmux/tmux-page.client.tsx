'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowUpRight,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  TerminalSquare,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  ApiError,
  createTmuxSession,
  killTmuxSession,
  listTmuxSessions,
  type TmuxSessionRow,
} from '../../../lib/api'
import { Button } from '../../../components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '../../../components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '../../../components/ui/resizable'
import { TerminalView } from '../../../components/terminal-view'
import { useLocalStorageState } from '../../../lib/use-local-storage-state'
import { useMediaQuery } from '../../../lib/use-media-query'
import { cn } from '../../../lib/utils'

type Filter = 'all' | 'active' | 'stale'
type Category = 'manual' | 'run' | 'exp' | 'project' | 'legacy' | null

const STALE_REASON_LABEL: Record<NonNullable<TmuxSessionRow['staleReason']>, string> = {
  'unknown-project': 'unknown-project',
  'unknown-target': 'unknown-target',
}

const MANUAL_PREFIX = 'memon-manual-'
const MANUAL_NAME_RE = /^[A-Za-z0-9._-]+$/

const SPLIT_STORAGE_KEY = 'memon:manage-tmux:split-sizes'
const SPLIT_PANEL_LEFT = 'tmux-list'
const SPLIT_PANEL_RIGHT = 'tmux-terminal'
const DESKTOP_DEFAULT_SIZES: Record<string, number> = {
  [SPLIT_PANEL_LEFT]: 33,
  [SPLIT_PANEL_RIGHT]: 67,
}
const MOBILE_DEFAULT_SIZES: Record<string, number> = {
  [SPLIT_PANEL_LEFT]: 50,
  [SPLIT_PANEL_RIGHT]: 50,
}

function popupTarget(row: TmuxSessionRow): string {
  return `memon-popup-${row.sessionName}`
}

function popupUrl(row: TmuxSessionRow): string | null {
  if (row.matchable) {
    const p = row.parsed
    if (!p.agent || !p.project || !p.scope || !p.slug) return null
    return (
      `/terminal-popup?project=${encodeURIComponent(p.project)}` +
      `&scope=${encodeURIComponent(p.scope)}` +
      `&slug=${encodeURIComponent(p.slug)}` +
      `&agent=${encodeURIComponent(p.agent)}`
    )
  }
  if (row.staleReason === null) {
    return `/terminal-popup?sessionName=${encodeURIComponent(row.sessionName)}`
  }
  return null
}

function targetHref(row: TmuxSessionRow): string | null {
  const p = row.parsed
  if (!row.matchable || !p.project || !p.scope) return null
  if (p.scope === 'project') {
    return `/p/${encodeURIComponent(p.project)}`
  }
  if (!p.slug) return null
  if (p.scope === 'run') {
    return `/p/${encodeURIComponent(p.project)}/r/${encodeURIComponent(p.slug)}`
  }
  return `/p/${encodeURIComponent(p.project)}/e/${encodeURIComponent(p.slug)}`
}

/**
 * Strip the universal `memon-` prefix and any of `manual-` / `project-` /
 * `exp-` / `run-` if it appears immediately after. Then classify into one
 * of the colored categories.
 */
function categorize(row: TmuxSessionRow): { category: Category; title: string } {
  const name = row.sessionName
  if (!name.startsWith('memon-')) return { category: null, title: name }
  const after = name.slice('memon-'.length)
  for (const prefix of ['manual-', 'project-', 'exp-', 'run-'] as const) {
    if (after.startsWith(prefix)) {
      return {
        category: prefix.slice(0, -1) as Category,
        title: after.slice(prefix.length),
      }
    }
  }
  const p = row.parsed
  if (p.scope === 'run') return { category: 'run', title: after }
  if (p.scope === 'exp') return { category: 'exp', title: after }
  if (p.scope === 'project') return { category: 'project', title: after }
  if (p.legacy) return { category: 'legacy', title: after }
  return { category: null, title: after }
}

const CATEGORY_CLASS: Record<NonNullable<Category>, string> = {
  manual:
    'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200',
  run:
    'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200',
  exp:
    'bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200',
  project:
    'bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-200',
  legacy:
    'bg-muted text-muted-foreground',
}

function CategoryBadge({
  category,
  muted,
}: {
  category: Category
  muted?: boolean
}) {
  if (category === null) return null
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
        muted ? CATEGORY_CLASS.legacy : CATEGORY_CLASS[category],
      )}
    >
      {category}
    </span>
  )
}

function MetaBadge({
  children,
  asLink,
  href,
  className,
}: {
  children: React.ReactNode
  asLink?: boolean
  href?: string
  className?: string
}) {
  const cls = cn(
    'inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground',
    className,
  )
  if (asLink && href) {
    return (
      <Link
        href={href}
        className={cn(cls, 'hover:bg-accent hover:text-foreground')}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </Link>
    )
  }
  return <span className={cls}>{children}</span>
}

function relativeTime(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso
  const diffMs = Date.now() - t
  if (diffMs < 0) return 'just now'
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  return `${diffDay}d ago`
}

function SessionCard({
  row,
  selected,
  onSelect,
  onAskKill,
}: {
  row: TmuxSessionRow
  selected: boolean
  onSelect: (sessionName: string) => void
  onAskKill: (sessionName: string) => void
}) {
  const { category, title } = categorize(row)
  const stale = row.staleReason !== null
  const p = row.parsed
  const href = targetHref(row)
  const popup = popupUrl(row)

  const handleSelect = () => {
    if (stale) return
    onSelect(row.sessionName)
  }
  const handleKey: React.KeyboardEventHandler<HTMLDivElement> = (e) => {
    if (stale) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect(row.sessionName)
    }
  }

  return (
    <div
      role={stale ? undefined : 'button'}
      tabIndex={stale ? -1 : 0}
      onClick={handleSelect}
      onKeyDown={handleKey}
      className={cn(
        'group rounded-md border p-2.5 transition-colors',
        stale ? 'opacity-75' : 'cursor-pointer hover:bg-accent/40',
        selected && !stale && 'border-l-2 border-l-primary bg-accent',
        !stale && 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <div className="flex items-start gap-2">
        <CategoryBadge category={category} muted={stale} />
        <span
          className="min-w-0 flex-1 truncate font-mono text-[11px]"
          title={row.sessionName}
        >
          {title}
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          {popup && (
            <Button
              variant="ghost"
              size="sm"
              className="hidden h-6 px-1.5 text-[10px] md:inline-flex"
              onClick={(e) => {
                e.stopPropagation()
                window.open(popup, popupTarget(row), 'popup,width=1200,height=800')
              }}
              aria-label="Open in popup"
            >
              <ExternalLink className="size-3" />
              Popup
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-[10px] text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation()
              onAskKill(row.sessionName)
            }}
            aria-label="Kill session"
          >
            <Trash2 className="size-3" />
            Kill
          </Button>
        </div>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 pl-0.5 text-[10px] text-muted-foreground">
        <span className="font-mono">
          {row.tmuxLastActivity ? relativeTime(row.tmuxLastActivity) : '—'}
        </span>
        {row.liveEntry !== null && <MetaBadge>:{row.liveEntry.port}</MetaBadge>}
        {p.agent !== null && p.agent !== 'none' && <MetaBadge>{p.agent}</MetaBadge>}
        {p.project !== null && <MetaBadge>{p.project}</MetaBadge>}
        {row.matchable && href && p.slug && (
          <MetaBadge asLink href={href}>
            {p.scope === 'project' ? 'project root' : p.slug}
            <ArrowUpRight className="size-2.5" />
          </MetaBadge>
        )}
        {stale && row.staleReason !== null && (
          <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
            <AlertTriangle className="size-2.5" />
            stale ({STALE_REASON_LABEL[row.staleReason]})
          </span>
        )}
      </div>
    </div>
  )
}

function LeftPane({
  rows,
  filter,
  setFilter,
  counts,
  selectedName,
  onSelect,
  onAskKill,
  isFetching,
  onRefetch,
  onAskCreate,
}: {
  rows: TmuxSessionRow[]
  filter: Filter
  setFilter: (f: Filter) => void
  counts: { all: number; active: number; stale: number }
  selectedName: string | null
  onSelect: (sessionName: string) => void
  onAskKill: (sessionName: string) => void
  isFetching: boolean
  onRefetch: () => void
  onAskCreate: () => void
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-sm font-semibold tracking-tight">tmux sessions</h1>
            <p className="text-[10px] text-muted-foreground">
              All <code className="rounded bg-muted px-1">memon-*</code> on this host
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="default"
              className="h-7 px-2 text-[11px]"
              onClick={onAskCreate}
            >
              <Plus className="size-3" />
              New
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              onClick={onRefetch}
              disabled={isFetching}
              aria-label="Refresh"
            >
              {isFetching ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <RefreshCw className="size-3" />
              )}
            </Button>
          </div>
        </div>
        <Tabs
          value={filter}
          onValueChange={(v) => setFilter(v as Filter)}
          className="mt-2"
        >
          <TabsList className="h-7">
            <TabsTrigger value="all" className="px-2 text-[11px]">
              All ({counts.all})
            </TabsTrigger>
            <TabsTrigger value="active" className="px-2 text-[11px]">
              Active ({counts.active})
            </TabsTrigger>
            <TabsTrigger value="stale" className="px-2 text-[11px]">
              Stale ({counts.stale})
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {rows.length === 0 ? (
          <p className="px-2 py-8 text-center text-xs text-muted-foreground">
            no sessions
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {rows.map((row) => (
              <SessionCard
                key={row.sessionName}
                row={row}
                selected={selectedName === row.sessionName}
                onSelect={onSelect}
                onAskKill={onAskKill}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function RightPaneEmpty() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground">
      <TerminalSquare className="size-8 opacity-50" />
      <p>Select a session from the list to attach.</p>
      <p className="max-w-xs text-[11px] opacity-75">
        Switch between sessions by clicking different rows — the terminal here
        reattaches without a popup or drawer.
      </p>
    </div>
  )
}

function RightPane({ row }: { row: TmuxSessionRow | null }) {
  if (row === null) return <RightPaneEmpty />
  const stale = row.staleReason !== null
  if (stale) return <RightPaneEmpty />
  const popup = popupUrl(row)
  const isMatchable =
    row.matchable &&
    row.parsed.agent !== null &&
    row.parsed.project !== null &&
    row.parsed.scope !== null &&
    row.parsed.slug !== null
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <span
          className="min-w-0 truncate font-mono text-[11px] text-muted-foreground"
          title={row.sessionName}
        >
          {row.sessionName}
        </span>
        {popup && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 shrink-0 px-2 text-[11px]"
            onClick={() =>
              window.open(popup, popupTarget(row), 'popup,width=1200,height=800')
            }
          >
            <ExternalLink className="size-3" />
            Pop out
          </Button>
        )}
      </div>
      <div className="flex flex-1 flex-col min-h-0">
        {isMatchable ? (
          <TerminalView
            key={row.sessionName}
            mode="standard"
            project={row.parsed.project!}
            scope={row.parsed.scope!}
            slug={row.parsed.slug!}
            agent={row.parsed.agent!}
          />
        ) : (
          <TerminalView
            key={row.sessionName}
            mode="raw"
            sessionName={row.sessionName}
          />
        )}
      </div>
    </div>
  )
}

export function TmuxManagePageClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const qc = useQueryClient()
  const [filter, setFilter] = useState<Filter>('all')
  const [killTarget, setKillTarget] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')

  const isDesktop = useMediaQuery('(min-width: 768px)')
  const defaultSizes = isDesktop ? DESKTOP_DEFAULT_SIZES : MOBILE_DEFAULT_SIZES
  const [sizes, setSizes] = useLocalStorageState<Record<string, number>>(
    SPLIT_STORAGE_KEY,
    defaultSizes,
  )
  const validSizes =
    sizes &&
    typeof sizes[SPLIT_PANEL_LEFT] === 'number' &&
    typeof sizes[SPLIT_PANEL_RIGHT] === 'number'
      ? sizes
      : defaultSizes

  const { data, isFetching, refetch } = useQuery({
    queryKey: ['tmux-sessions'],
    queryFn: listTmuxSessions,
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
  })
  const allFromQuery = data?.sessions

  // Stable client-side ordering: the list order is frozen across the 5s
  // polling so the user can manage sessions without rows jumping around.
  // The order is re-snapshotted from the API (which sorts by lastActivity
  // desc) only when (a) a new sessionName appears, or (b) the user clicks
  // Refresh explicitly.
  const [orderedNames, setOrderedNames] = useState<string[] | null>(null)
  useEffect(() => {
    if (!allFromQuery) return
    setOrderedNames((prev) => {
      const currentNames = allFromQuery.map((s) => s.sessionName)
      if (prev === null) return currentNames
      const currentSet = new Set(currentNames)
      const hasNew = currentNames.some((n) => !prev.includes(n))
      if (hasNew) return currentNames
      const filtered = prev.filter((n) => currentSet.has(n))
      return filtered.length === prev.length ? prev : filtered
    })
  }, [allFromQuery])

  const all = allFromQuery ?? []
  const allByName = useMemo(
    () => new Map(all.map((s) => [s.sessionName, s])),
    [all],
  )
  const orderedAll = useMemo(() => {
    if (orderedNames === null) return all
    const seen = new Set<string>()
    const out: TmuxSessionRow[] = []
    for (const n of orderedNames) {
      const r = allByName.get(n)
      if (r !== undefined && !seen.has(n)) {
        out.push(r)
        seen.add(n)
      }
    }
    // Defensive: append any row that's in the data but somehow missing
    // from the order (shouldn't happen because the effect catches new
    // names, but keeps the render honest if the effect hasn't fired yet).
    for (const r of all) {
      if (!seen.has(r.sessionName)) out.push(r)
    }
    return out
  }, [all, orderedNames, allByName])

  const visible = orderedAll.filter((s) => {
    if (filter === 'active') return s.liveEntry !== null
    if (filter === 'stale') return s.staleReason !== null
    return true
  })

  const handleRefresh = async () => {
    const result = await refetch()
    const sessions = result.data?.sessions ?? []
    setOrderedNames(sessions.map((s) => s.sessionName))
  }

  const selectedName = searchParams.get('session')
  const selectedRow = useMemo(
    () => (selectedName ? (all.find((s) => s.sessionName === selectedName) ?? null) : null),
    [all, selectedName],
  )

  useEffect(() => {
    if (
      selectedName &&
      all.length > 0 &&
      !all.some((s) => s.sessionName === selectedName)
    ) {
      router.replace('/manage/tmux')
    }
  }, [selectedName, all, router])

  const writeSelection = (name: string | null) => {
    if (name === null) {
      router.replace('/manage/tmux')
      return
    }
    router.replace(`/manage/tmux?session=${encodeURIComponent(name)}`)
  }

  const killMutation = useMutation({
    mutationFn: (name: string) => killTmuxSession(name),
    onSuccess: (_data, name) => {
      toast.success(`killed ${name}`)
      void qc.invalidateQueries({ queryKey: ['tmux-sessions'] })
      setKillTarget(null)
      if (selectedName === name) writeSelection(null)
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : (err as Error).message
      toast.error(`kill failed: ${msg}`)
    },
  })

  const createMutation = useMutation({
    mutationFn: (name: string) => createTmuxSession({ name }),
    onSuccess: (res) => {
      toast.success(
        res.alreadyExisted
          ? `joined existing ${res.sessionName}`
          : `created ${res.sessionName}`,
      )
      void qc.invalidateQueries({ queryKey: ['tmux-sessions'] })
      setCreateOpen(false)
      setCreateName('')
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : (err as Error).message
      toast.error(`create failed: ${msg}`)
    },
  })

  const counts = {
    all: all.length,
    active: all.filter((s) => s.liveEntry !== null).length,
    stale: all.filter((s) => s.staleReason !== null).length,
  }

  const trimmedCreateName = createName.trim()
  const createNameValid =
    trimmedCreateName.length > 0 &&
    MANUAL_NAME_RE.test(trimmedCreateName) &&
    !trimmedCreateName.includes('--') &&
    !trimmedCreateName.startsWith('memon-')

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!createNameValid || createMutation.isPending) return
    createMutation.mutate(trimmedCreateName)
  }

  return (
    <>
      <ResizablePanelGroup
        orientation={isDesktop ? 'horizontal' : 'vertical'}
        defaultLayout={validSizes}
        onLayoutChanged={(layout) => setSizes(layout)}
        className="h-full w-full"
      >
        <ResizablePanel
          id={SPLIT_PANEL_LEFT}
          defaultSize={validSizes[SPLIT_PANEL_LEFT]}
          minSize={isDesktop ? 18 : 25}
        >
          <LeftPane
            rows={visible}
            filter={filter}
            setFilter={setFilter}
            counts={counts}
            selectedName={selectedName}
            onSelect={writeSelection}
            onAskKill={(name) => setKillTarget(name)}
            isFetching={isFetching}
            onRefetch={() => void handleRefresh()}
            onAskCreate={() => setCreateOpen(true)}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel
          id={SPLIT_PANEL_RIGHT}
          defaultSize={validSizes[SPLIT_PANEL_RIGHT]}
          minSize={isDesktop ? 35 : 25}
        >
          <RightPane row={selectedRow} />
        </ResizablePanel>
      </ResizablePanelGroup>

      <Dialog open={killTarget !== null} onOpenChange={(o) => !o && setKillTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kill tmux session?</DialogTitle>
            <DialogDescription>
              This runs <code className="rounded bg-muted px-1">tmux kill-session</code> on the host.
              Any agent / shell running inside terminates. Conversations stored
              by claude / codex / opencode locally are preserved and the next
              open of the same combo auto-resumes.
            </DialogDescription>
          </DialogHeader>
          <pre className="overflow-x-auto rounded bg-muted p-2 font-mono text-[11px]">
            {killTarget}
          </pre>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setKillTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={killMutation.isPending}
              onClick={() => killTarget && killMutation.mutate(killTarget)}
            >
              {killMutation.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              Kill session
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createOpen}
        onOpenChange={(o) => {
          if (!o && !createMutation.isPending) {
            setCreateOpen(false)
            setCreateName('')
          }
        }}
      >
        <DialogContent>
          <form onSubmit={handleCreateSubmit}>
            <DialogHeader>
              <DialogTitle>New tmux session</DialogTitle>
              <DialogDescription>
                Creates a manually-named tmux session with cwd =
                <code className="ml-1 rounded bg-muted px-1">memon serve</code>'s working directory.
                If the name already exists, joins the existing session
                instead of erroring.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-3">
              <Label htmlFor="manual-session-name" className="text-xs">
                Name
              </Label>
              <div className="flex items-stretch overflow-hidden rounded-md border bg-background">
                <span className="flex items-center bg-muted px-2 font-mono text-[11px] text-muted-foreground">
                  {MANUAL_PREFIX}
                </span>
                <Input
                  id="manual-session-name"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="my-scratch"
                  className="rounded-none border-0 font-mono text-xs focus-visible:ring-0"
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  disabled={createMutation.isPending}
                />
              </div>
              <p className="text-[10px] text-muted-foreground">
                Allowed: letters, digits, <code>.</code>, <code>_</code>, <code>-</code>.
                No <code>--</code>. Cannot start with <code>memon-</code>.
              </p>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setCreateOpen(false)
                  setCreateName('')
                }}
                disabled={createMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={!createNameValid || createMutation.isPending}
              >
                {createMutation.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Plus className="size-3.5" />
                )}
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
