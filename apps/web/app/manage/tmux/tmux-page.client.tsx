'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowUpRight,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Sidebar,
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
import { useTerminalDrawer } from '../../../components/terminal-drawer-provider'
import { cn } from '../../../lib/utils'

type Filter = 'all' | 'active' | 'stale'

const STALE_REASON_LABEL: Record<NonNullable<TmuxSessionRow['staleReason']>, string> = {
  'unknown-project': 'unknown-project',
  'unknown-target': 'unknown-target',
}

const MANUAL_PREFIX = 'memon-manual-'
const MANUAL_NAME_RE = /^[A-Za-z0-9._-]+$/

function popupTarget(row: TmuxSessionRow): string {
  return `memon-popup-${row.sessionName}`
}

function popupUrl(row: TmuxSessionRow): string | null {
  const p = row.parsed
  if (!p.agent || !p.project || !p.scope || !p.slug) return null
  return (
    `/terminal-popup?project=${encodeURIComponent(p.project)}` +
    `&scope=${encodeURIComponent(p.scope)}` +
    `&slug=${encodeURIComponent(p.slug)}` +
    `&agent=${encodeURIComponent(p.agent)}`
  )
}

function targetHref(row: TmuxSessionRow): string | null {
  const p = row.parsed
  if (!row.matchable || !p.project || !p.scope || !p.slug) return null
  if (p.scope === 'run') {
    return `/p/${encodeURIComponent(p.project)}/r/${encodeURIComponent(p.slug)}`
  }
  return `/p/${encodeURIComponent(p.project)}/e/${encodeURIComponent(p.slug)}`
}

export function TmuxManagePageClient() {
  const drawer = useTerminalDrawer()
  const qc = useQueryClient()
  const [filter, setFilter] = useState<Filter>('all')
  const [killTarget, setKillTarget] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')

  const { data, isFetching, refetch } = useQuery({
    queryKey: ['tmux-sessions'],
    queryFn: listTmuxSessions,
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
  })
  const all = data?.sessions ?? []
  const visible = all.filter((s) => {
    if (filter === 'active') return s.liveEntry !== null
    // Stale tab shows ONLY rows with a non-null staleReason. Manual rows
    // (matchable=false but staleReason=null) are NOT stale and don't appear here.
    if (filter === 'stale') return s.staleReason !== null
    return true
  })

  const killMutation = useMutation({
    mutationFn: (name: string) => killTmuxSession(name),
    onSuccess: (_data, name) => {
      toast.success(`killed ${name}`)
      void qc.invalidateQueries({ queryKey: ['tmux-sessions'] })
      setKillTarget(null)
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

  const handleOpenDrawer = (row: TmuxSessionRow) => {
    const p = row.parsed
    if (!p.agent || !p.project || !p.scope || !p.slug) {
      toast.error('cannot open: session name does not parse')
      return
    }
    drawer.open({ project: p.project, scope: p.scope, slug: p.slug, agent: p.agent })
  }

  const handleOpenPopup = (row: TmuxSessionRow) => {
    const url = popupUrl(row)
    if (!url) {
      toast.error('cannot open popup: session name does not parse')
      return
    }
    window.open(url, popupTarget(row), 'popup,width=1200,height=800')
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
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">tmux sessions</h1>
          <p className="text-xs text-muted-foreground">
            All <code className="rounded bg-muted px-1">memon-*</code> tmux
            sessions on this host. Sessions persist across <code className="rounded bg-muted px-1">memon serve</code> restarts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="default" onClick={() => setCreateOpen(true)}>
            <Plus className="size-3.5" />
            New session
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            {isFetching ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
        <TabsList>
          <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
          <TabsTrigger value="active">Active in memon ({counts.active})</TabsTrigger>
          <TabsTrigger value="stale">Stale ({counts.stale})</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-xs">
          <thead className="bg-muted/40">
            <tr className="text-left">
              <Th>Session</Th>
              <Th>Agent</Th>
              <Th>Scope</Th>
              <Th>Project</Th>
              <Th>Target</Th>
              <Th>ttyd</Th>
              <Th>Last activity</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={8} className="p-8 text-center text-muted-foreground">
                  no sessions
                </td>
              </tr>
            )}
            {visible.map((row) => (
              <SessionRow
                key={row.sessionName}
                row={row}
                onOpenDrawer={handleOpenDrawer}
                onOpenPopup={handleOpenPopup}
                onAskKill={(name) => setKillTarget(name)}
              />
            ))}
          </tbody>
        </table>
      </div>

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
    </div>
  )
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={cn('px-3 py-2 font-medium text-muted-foreground', className)}>
      {children}
    </th>
  )
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <td className={cn('px-3 py-2 align-top', className)}>{children}</td>
}

function SessionRow({
  row,
  onOpenDrawer,
  onOpenPopup,
  onAskKill,
}: {
  row: TmuxSessionRow
  onOpenDrawer: (row: TmuxSessionRow) => void
  onOpenPopup: (row: TmuxSessionRow) => void
  onAskKill: (name: string) => void
}) {
  const p = row.parsed
  const href = targetHref(row)
  return (
    <tr className="border-t hover:bg-muted/20">
      <Td className="font-mono text-[11px]">{row.sessionName}</Td>
      <Td>
        {p.agent ? (
          <span className="font-mono">{p.agent === 'none' ? 'terminal' : p.agent}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </Td>
      <Td>
        {p.scope ? (
          <span className="font-mono">{p.scope}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </Td>
      <Td>
        {p.project ? (
          <span className="font-mono">{p.project}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </Td>
      <Td>
        {row.matchable && href ? (
          <Link
            href={href}
            className="inline-flex items-center gap-1 font-mono text-[11px] text-primary hover:underline"
          >
            {p.slug}
            <ArrowUpRight className="size-3" />
          </Link>
        ) : row.staleReason !== null ? (
          <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
            <AlertTriangle className="size-3" />
            <span className="text-[11px]">
              stale ({STALE_REASON_LABEL[row.staleReason]})
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </Td>
      <Td>
        {row.liveEntry ? (
          <span className="inline-flex items-center gap-1 font-mono">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            :{row.liveEntry.port}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </Td>
      <Td className="font-mono text-[11px] text-muted-foreground">
        {row.tmuxLastActivity ? relativeTime(row.tmuxLastActivity) : '—'}
      </Td>
      <Td className="text-right">
        <div className="inline-flex items-center gap-1">
          {row.matchable && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={() => onOpenDrawer(row)}
              >
                <Sidebar className="size-3" />
                Drawer
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="hidden h-7 px-2 text-[11px] md:inline-flex"
                onClick={() => onOpenPopup(row)}
              >
                <ExternalLink className="size-3" />
                Popup
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => onAskKill(row.sessionName)}
          >
            <Trash2 className="size-3" />
            Kill
          </Button>
        </div>
      </Td>
    </tr>
  )
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
