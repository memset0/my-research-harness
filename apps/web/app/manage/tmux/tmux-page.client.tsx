'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  Archive,
  Bot,
  ExternalLink,
  FlaskConical,
  FolderTree,
  Loader2,
  Plus,
  RefreshCw,
  TerminalSquare,
  Trash2,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  ApiError,
  createTmuxSession,
  killTmuxSession,
  listTmuxSessions,
  type TmuxPaneInfo,
  type TmuxPaneState,
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
import type { GroupImperativeHandle, Layout } from 'react-resizable-panels'
import { TerminalView } from '../../../components/terminal-view'
import { ViewerGuard } from '../../../components/viewer-guard'
import { useMediaQuery } from '../../../lib/use-media-query'
import { cn } from '../../../lib/utils'

type Filter = 'all' | 'active' | 'stale'

const STALE_REASON_LABEL: Record<NonNullable<TmuxSessionRow['staleReason']>, string> = {
  'unknown-project': 'unknown-project',
  'unknown-target': 'unknown-target',
}

const MANUAL_PREFIX = 'memon-manual-'
const MANUAL_NAME_RE = /^[A-Za-z0-9._-]+$/

export const SPLIT_STORAGE_KEY = 'memon:manage-tmux:split-sizes'
export const SPLIT_PANEL_LEFT = 'tmux-list'
export const SPLIT_PANEL_RIGHT = 'tmux-terminal'
const SPLIT_WRITE_DEBOUNCE_MS = 250

export function parseStoredLayout(raw: string | null): Layout | null {
  if (raw === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null
  }
  const obj = parsed as Record<string, unknown>
  const left = obj[SPLIT_PANEL_LEFT]
  const right = obj[SPLIT_PANEL_RIGHT]
  if (typeof left !== 'number' || typeof right !== 'number') return null
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null
  if (left < 0 || left > 100 || right < 0 || right > 100) return null
  if (Math.abs(left + right - 100) > 0.5) return null
  return { [SPLIT_PANEL_LEFT]: left, [SPLIT_PANEL_RIGHT]: right }
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
 * `exp-` / `run-` if it appears immediately after, for use as the card title.
 */
function stripTitle(sessionName: string): string {
  if (!sessionName.startsWith('memon-')) return sessionName
  const after = sessionName.slice('memon-'.length)
  for (const prefix of ['manual-', 'project-', 'exp-', 'run-'] as const) {
    if (after.startsWith(prefix)) return after.slice(prefix.length)
  }
  return after
}

const BADGE_COLORS = {
  port: 'bg-muted text-emerald-700 dark:text-emerald-300',
  agent:
    'border border-orange-200 bg-orange-100 text-orange-900 dark:border-orange-900/60 dark:bg-orange-900/40 dark:text-orange-200',
  run:
    'border border-emerald-200 bg-emerald-100 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-900/40 dark:text-emerald-200',
  exp:
    'border border-sky-200 bg-sky-100 text-sky-900 dark:border-sky-900/60 dark:bg-sky-900/40 dark:text-sky-200',
  // Used by both the project-scope ScopeBadge and the standalone project
  // badge on run/exp rows — the two are visually unified per the
  // polish-tmux-card-layout change.
  projectScope:
    'border border-violet-200 bg-violet-100 text-violet-900 dark:border-violet-900/60 dark:bg-violet-900/40 dark:text-violet-200',
  legacy: 'border border-transparent bg-muted text-muted-foreground',
  stale:
    'border border-amber-200 bg-amber-100 text-amber-900 dark:border-amber-900/60 dark:bg-amber-900/40 dark:text-amber-200',
} as const

/** Per-state visuals for the small corner badge that sits in the
 *  bottom-right of the card footer. `idle` has no badge — the state is
 *  encoded by its ABSENCE so idle cards stay visually quiet. */
const STATE_BADGE_CONFIG: Record<
  Exclude<TmuxPaneState, 'idle'>,
  { label: string; chip: string; dot: string }
> = {
  running: {
    label: 'RUNNING',
    chip: 'bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-200',
    dot: 'bg-blue-500',
  },
  attention: {
    label: 'ATTENTION',
    chip: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200',
    dot: 'bg-amber-500',
  },
  done: {
    label: 'DONE',
    chip: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200',
    dot: 'bg-emerald-500',
  },
}

function StateBadge({ state }: { state: TmuxPaneState }) {
  if (state === 'idle') return null
  const cfg = STATE_BADGE_CONFIG[state]
  // `font-sans` overrides the parent footer's `font-mono` so the
  // all-caps label reads as a proper status pill, not as code text.
  return (
    <span
      className={cn(
        'ml-auto inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5',
        'text-[10px] font-sans font-semibold tracking-wide',
        cfg.chip,
      )}
    >
      <span className={cn('size-1.5 shrink-0 rounded-full', cfg.dot)} aria-hidden />
      {cfg.label}
    </span>
  )
}

function MetaBadge({
  icon: Icon,
  prefix,
  value,
  className,
  asLink,
  href,
  openInNewTab,
}: {
  icon: LucideIcon
  prefix?: string
  value: React.ReactNode
  className?: string
  asLink?: boolean
  href?: string
  openInNewTab?: boolean
}) {
  const cls = cn(
    'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]',
    className,
  )
  const content = (
    <>
      <Icon className="size-3 shrink-0" />
      {prefix !== undefined && <span className="font-medium">{prefix}</span>}
      <span className="font-mono">{value}</span>
    </>
  )
  if (asLink && href) {
    const linkProps = openInNewTab
      ? { target: '_blank' as const, rel: 'noopener noreferrer' as const }
      : {}
    return (
      <Link
        href={href}
        className={cn(cls, 'hover:brightness-110 hover:underline')}
        onClick={(e) => e.stopPropagation()}
        {...linkProps}
      >
        {content}
      </Link>
    )
  }
  return <span className={cls}>{content}</span>
}

function PortBadge({ port }: { port: number }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]',
        BADGE_COLORS.port,
      )}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
      <span className="font-mono">:{port}</span>
    </span>
  )
}

function AgentBadge({ agent }: { agent: string }) {
  return <MetaBadge icon={Bot} value={agent} className={BADGE_COLORS.agent} />
}

/**
 * Project badge for run/exp rows. Visually unified with the project-scope
 * ScopeBadge variant — same FolderTree icon, same violet color family, same
 * `Project <name>` text shape, same link to `/p/<project>`.
 *
 * Render condition: `parsed.project !== null && parsed.scope !== 'project'`
 * (project-scope rows render only the ScopeBadge so the project name doesn't
 * duplicate).
 */
function ProjectBadge({ project }: { project: string }) {
  return (
    <MetaBadge
      icon={FolderTree}
      value={project}
      className={BADGE_COLORS.projectScope}
      asLink
      href={`/p/${encodeURIComponent(project)}`}
      openInNewTab
    />
  )
}

type ScopeBadgeVariant =
  | { kind: 'stale'; reason: 'unknown-project' | 'unknown-target' }
  | { kind: 'run'; project: string; slug: string }
  | { kind: 'exp'; project: string; slug: string }
  | { kind: 'project'; project: string }
  | { kind: 'legacy' }
  | { kind: 'other' }

/**
 * Single source of truth for what scope-badge variant (if any) a row maps
 * to. `null` means NO scope badge renders. The `memon-manual-` branch in
 * particular now resolves to `null` — manual rows render zero scope/target
 * badges (the previous `Wrench`/`Manual` amber chip is gone).
 *
 * Returning a variant tag instead of a JSX element lets the parent
 * compute `hasAnyBadge` before render without duplicating the cascade.
 */
function classifyScopeBadge(row: TmuxSessionRow): ScopeBadgeVariant | null {
  const p = row.parsed
  if (row.staleReason !== null) return { kind: 'stale', reason: row.staleReason }
  if (row.matchable && p.project && p.scope === 'run' && p.slug) {
    return { kind: 'run', project: p.project, slug: p.slug }
  }
  if (row.matchable && p.project && p.scope === 'exp' && p.slug) {
    return { kind: 'exp', project: p.project, slug: p.slug }
  }
  if (row.matchable && p.project && p.scope === 'project') {
    return { kind: 'project', project: p.project }
  }
  if (row.sessionName.startsWith('memon-manual-')) return null
  if (p.legacy) return { kind: 'legacy' }
  return { kind: 'other' }
}

function ScopeBadge({ row }: { row: TmuxSessionRow }) {
  const variant = classifyScopeBadge(row)
  if (variant === null) return null
  if (variant.kind === 'stale') {
    return (
      <MetaBadge
        icon={AlertTriangle}
        value={`Stale (${STALE_REASON_LABEL[variant.reason]})`}
        className={BADGE_COLORS.stale}
      />
    )
  }
  if (variant.kind === 'run') {
    return (
      <MetaBadge
        icon={Zap}
        value={variant.slug}
        className={BADGE_COLORS.run}
        asLink
        href={`/p/${encodeURIComponent(variant.project)}/r/${encodeURIComponent(variant.slug)}`}
        openInNewTab
      />
    )
  }
  if (variant.kind === 'exp') {
    return (
      <MetaBadge
        icon={FlaskConical}
        value={variant.slug}
        className={BADGE_COLORS.exp}
        asLink
        href={`/p/${encodeURIComponent(variant.project)}/e/${encodeURIComponent(variant.slug)}`}
        openInNewTab
      />
    )
  }
  if (variant.kind === 'project') {
    return (
      <MetaBadge
        icon={FolderTree}
        value={variant.project}
        className={BADGE_COLORS.projectScope}
        asLink
        href={`/p/${encodeURIComponent(variant.project)}`}
        openInNewTab
      />
    )
  }
  if (variant.kind === 'legacy') {
    return <MetaBadge icon={Archive} value="Legacy" className={BADGE_COLORS.legacy} />
  }
  return <MetaBadge icon={Archive} value="Other" className={BADGE_COLORS.legacy} />
}

/**
 * Commands that, when present alongside a title, add no information beyond
 * "an idle shell is in the foreground". We suppress the command in that case
 * so the line reads cleanly. If NO title is available, we render the command
 * anyway so the line isn't blank.
 */
const UNINFORMATIVE_SHELLS = new Set(['bash', 'zsh', 'sh', 'fish', 'tmux'])

function displayPane(pane: TmuxPaneInfo | null): { command: string | null; title: string | null } {
  if (!pane) return { command: null, title: null }
  const title = pane.title && pane.title.length > 0 ? pane.title : null
  const rawCmd = pane.currentCommand && pane.currentCommand.length > 0 ? pane.currentCommand : null
  let command = rawCmd
  if (command && UNINFORMATIVE_SHELLS.has(command) && title !== null) {
    command = null
  }
  return { command, title }
}

function CardFooter({
  pane,
  state,
}: {
  pane: TmuxPaneInfo | null
  state: TmuxPaneState
}) {
  const { command, title } = displayPane(pane)
  const hasPaneContent = command !== null || title !== null
  const hasStateBadge = state !== 'idle'
  if (!hasPaneContent && !hasStateBadge) return null

  // Claude-specific render: orange ✻ glyph + word "Claude". The `aria-hidden`
  // on the glyph keeps screen-reader output as just "Claude". For every
  // other command we render the generic Activity icon + the command text.
  const isClaude = pane?.currentCommand === 'claude'

  return (
    <div
      className={cn(
        'mt-2 -mx-2.5 border-t border-border/40 px-2.5 pt-1.5',
        'flex items-center gap-1 text-[10px] font-mono text-foreground/85',
      )}
    >
      {hasPaneContent && (
        <>
          {isClaude ? (
            <span className="shrink-0 font-semibold text-orange-600 dark:text-orange-400">
              <span aria-hidden>✻</span> Claude
            </span>
          ) : (
            <>
              <Activity className="size-3 shrink-0 text-foreground/60" aria-hidden />
              {command !== null && (
                <span className="shrink-0 font-semibold">{command}</span>
              )}
            </>
          )}
          {((isClaude && title !== null) || (!isClaude && command !== null && title !== null)) && (
            <span className="opacity-60">·</span>
          )}
          {title !== null && <span className="min-w-0 truncate">{title}</span>}
        </>
      )}
      <StateBadge state={state} />
    </div>
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

/**
 * The card's "last activity" timestamp is the most recent of:
 *   - tmux's session_activity (input/output bumps it; covers user typing
 *     and program output, including the redraw when ttyd attaches),
 *   - the server-observed last state transition for this sessionName
 *     (running ↔ idle ↔ attention ↔ done).
 *
 * Returns an ISO8601 string suitable for `relativeTime`, or `null` when
 * neither input is parseable (which renders as `—` in the card).
 */
function pickDisplayActivity(row: TmuxSessionRow): string | null {
  const a = Date.parse(row.tmuxLastActivity)
  const b = row.lastStateChangeAt ? Date.parse(row.lastStateChangeAt) : NaN
  const aValid = Number.isFinite(a)
  const bValid = Number.isFinite(b)
  if (!aValid && !bValid) return null
  if (!aValid) return row.lastStateChangeAt
  if (!bValid) return row.tmuxLastActivity
  return b > a ? row.lastStateChangeAt : row.tmuxLastActivity
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
  const stale = row.staleReason !== null
  const p = row.parsed
  const popup = popupUrl(row)
  const title = stripTitle(row.sessionName)

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

  // Browser-tooltip on the whole card: show the full untruncated pane title
  // when present so the user can hover the line (or anywhere on the card)
  // to read past the visual truncation.
  const cardTitle = row.pane?.title ?? undefined

  // Compute whether row 2 (badges) should render at all. Manual rows with
  // no liveEntry / no parsed agent / no parsed project collapse to row 1
  // only.
  const hasPort = row.liveEntry !== null
  const hasAgent = p.agent !== null && p.agent !== 'none'
  const hasProject = p.project !== null && p.scope !== 'project'
  const hasScopeBadge = classifyScopeBadge(row) !== null
  const hasAnyBadge = hasPort || hasAgent || hasProject || hasScopeBadge

  return (
    <div
      role={stale ? undefined : 'button'}
      tabIndex={stale ? -1 : 0}
      onClick={handleSelect}
      onKeyDown={handleKey}
      title={cardTitle}
      className={cn(
        'group rounded-md border bg-card p-2.5 transition-colors',
        stale ? 'opacity-75' : 'cursor-pointer hover:bg-accent/40',
        selected && !stale && 'border-primary',
        !stale && 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      {/* Content row 1: title + time + icon-only actions */}
      <div className="flex items-center gap-2">
        <span
          className="min-w-0 flex-1 truncate font-mono text-[11px] font-semibold"
          title={row.sessionName}
        >
          {title}
        </span>
        {(() => {
          const ts = pickDisplayActivity(row)
          return ts ? (
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {relativeTime(ts)}
            </span>
          ) : null
        })()}
        <div className="flex shrink-0 items-center gap-0.5">
          {popup && (
            <ViewerGuard reason="Manage tmux session">
              <Button
                variant="ghost"
                size="sm"
                className="hidden h-6 w-6 p-0 md:inline-flex"
                onClick={(e) => {
                  e.stopPropagation()
                  window.open(popup, popupTarget(row), 'popup,width=1200,height=800')
                }}
                aria-label="Open in popup"
              >
                <ExternalLink className="size-3" />
              </Button>
            </ViewerGuard>
          )}
          <ViewerGuard reason="Manage tmux session">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation()
                onAskKill(row.sessionName)
              }}
              aria-label="Kill session"
            >
              <Trash2 className="size-3" />
            </Button>
          </ViewerGuard>
        </div>
      </div>

      {/* Content row 2: badges (omitted entirely when no badge applies) */}
      {hasAnyBadge && (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 pl-0.5 text-[10px] text-muted-foreground">
          {hasPort && <PortBadge port={row.liveEntry!.port} />}
          {hasAgent && <AgentBadge agent={p.agent!} />}
          {hasProject && <ProjectBadge project={p.project!} />}
          <ScopeBadge row={row} />
        </div>
      )}

      {/* Footer: pane info + state-driven background tint */}
      <CardFooter pane={row.pane} state={row.state} />
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
            <ViewerGuard reason="Manage tmux session">
              <Button
                size="sm"
                variant="default"
                className="h-7 px-2 text-[11px]"
                onClick={onAskCreate}
              >
                <Plus className="size-3" />
                New
              </Button>
            </ViewerGuard>
            <ViewerGuard reason="Manage tmux session">
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
            </ViewerGuard>
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
  const { command: paneCmd, title: paneTitle } = displayPane(row.pane)
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className="shrink-0 truncate font-mono text-[11px] text-muted-foreground"
            title={row.sessionName}
          >
            {row.sessionName}
          </span>
          {(paneCmd !== null || paneTitle !== null) && (
            <span
              className="flex min-w-0 items-center gap-1 font-mono text-[10px] text-muted-foreground/80"
              title={paneTitle ?? undefined}
            >
              <span className="opacity-60">·</span>
              {paneCmd !== null && <span className="shrink-0">{paneCmd}</span>}
              {paneCmd !== null && paneTitle !== null && (
                <span className="opacity-60">·</span>
              )}
              {paneTitle !== null && (
                <span className="min-w-0 truncate">{paneTitle}</span>
              )}
            </span>
          )}
        </div>
        {popup && (
          <ViewerGuard reason="Manage tmux session">
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
          </ViewerGuard>
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

  const isDesktop = useMediaQuery('(min-width: 768px)', true)

  const groupRef = useRef<GroupImperativeHandle | null>(null)
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return
    let raw: string | null
    try {
      raw = window.localStorage.getItem(SPLIT_STORAGE_KEY)
    } catch {
      return
    }
    const layout = parseStoredLayout(raw)
    if (layout !== null) {
      groupRef.current?.setLayout(layout)
    }
  }, [])

  useEffect(
    () => () => {
      if (writeTimer.current) clearTimeout(writeTimer.current)
    },
    [],
  )

  const handleLayoutChanged = useCallback((layout: Layout) => {
    if (writeTimer.current) clearTimeout(writeTimer.current)
    writeTimer.current = setTimeout(() => {
      if (typeof window === 'undefined') return
      try {
        window.localStorage.setItem(SPLIT_STORAGE_KEY, JSON.stringify(layout))
      } catch {
        // private mode / quota — drop silently, in-memory state is still correct
      }
    }, SPLIT_WRITE_DEBOUNCE_MS)
  }, [])

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
        groupRef={groupRef}
        onLayoutChanged={handleLayoutChanged}
        className="h-full w-full"
      >
        <ResizablePanel
          id={SPLIT_PANEL_LEFT}
          defaultSize={isDesktop ? '300px' : '50%'}
          minSize={isDesktop ? '180px' : 25}
          maxSize={isDesktop ? '50%' : undefined}
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
            <ViewerGuard reason="Manage tmux session">
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
            </ViewerGuard>
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
              <ViewerGuard reason="Manage tmux session">
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
              </ViewerGuard>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
