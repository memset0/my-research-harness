'use client'
import { translationSources } from '../lib/translation/sources'
import { BodyTranslation } from './body-translation'

// Inbox shell for the per-project Reports view.
// Desktop: 2-column read mode (rail + rendered) → 3-column when editing
// (rail + rendered + Monaco). Mobile: rendered only with a FAB that opens
// a right-side Sheet showing the rail; tapping Edit opens a full-viewport
// bottom Sheet with Monaco.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, List, PanelLeftClose, PanelLeftOpen, Pencil, X } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  type FullReport,
  fetchReport,
  fetchReports,
  type ProjectTarget,
  projectHost,
  projectName,
  projectQueryKey,
  projectWebPath,
  putReport,
  type ReportListItem,
} from '../lib/api'
import { splitFrontmatter } from '../lib/frontmatter'
import { queryKeys } from '../lib/query-keys'
import { useUserPreferenceState } from '../lib/use-user-preference-state'
import { cn } from '../lib/utils'
import { DocumentArtifactLinkProvider } from './document-artifact-link-provider'
import { FrontmatterPanel } from './frontmatter-panel'
import { Markdown } from './markdown'
import { ReadmeMonaco } from './readme-monaco'
import { ReportHtmlZoomProvider } from './report-html-embed'
import { ListSkeleton } from './skeletons'
import { TimestampLocal } from './timestamp'
import { Button } from './ui/button'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from './ui/sheet'

export type InboxKind = 'reports'

interface CommonItem {
  id: string
  path?: string
  resource?: string
  mtime: number
  title: string | null
  /** Report slug sub-label. */
  subLabel: string
}

interface FullItem {
  id: string
  path?: string
  resource?: string
  mtime: number
  hash: string
  content: string
  subLabel: string
  format?: 'markdown' | 'bundle'
}

const EMPTY_COPY = {
  reports: {
    rail: 'no reports yet',
    body: 'No reports yet. Reports are written by `memon-write-report`; pick a hypothesis or set of experiments and ask the skill to summarize.',
  },
} as const

const ERROR_COPY = {
  reports: { rail: 'failed to load reports' },
} as const

const REPORT_TIMESTAMP_KEYS = ['created_at', 'updated_at'] as const
const REPORT_PICKER_PREFERENCE_KEY = 'memon:reports:picker-open'

export function InboxShell({
  kind,
  project,
  selectedId,
}: {
  kind: InboxKind
  project: ProjectTarget
  selectedId: string | null
}) {
  const {
    items,
    isLoading: itemsLoading,
    error: itemsError,
    refetch: refetchItems,
  } = useItemsList(kind, project)
  const selected = useSelectedItem(kind, project, selectedId)
  const [storedReportRailOpen, setReportRailOpen] = useUserPreferenceState<boolean>(
    REPORT_PICKER_PREFERENCE_KEY,
    true,
  )
  const reportRailOpen = typeof storedReportRailOpen === 'boolean' ? storedReportRailOpen : true

  const empty = EMPTY_COPY[kind]
  const showDesktopRail = reportRailOpen
  const showReportRail = kind === 'reports' && !reportRailOpen

  return (
    <div className="flex h-[calc(100svh-3rem)] overflow-hidden">
      {/* Left rail — desktop only */}
      {showDesktopRail && (
        <aside
          aria-label={'Report picker'}
          className="hidden w-72 shrink-0 border-r md:flex md:flex-col"
          data-inbox-rail={kind}
        >
          <RailHeader
            kind={kind}
            count={items.length}
            onHideReports={kind === 'reports' ? () => setReportRailOpen(false) : undefined}
          />
          <div className="flex-1 overflow-y-auto">
            <RailList
              kind={kind}
              project={project}
              items={items}
              selectedId={selectedId}
              loading={itemsLoading}
              error={itemsError}
              onRetry={refetchItems}
            />
          </div>
        </aside>
      )}

      {/* Right pane — rendered markdown + edit toggle.
          overflow-x-hidden alongside overflow-y-auto is needed to defeat
          the CSS Overflow Module 3 "auto-x trap" (overflow-y: auto with
          overflow-x: visible computes overflow-x to auto, producing a
          stray horizontal scrollbar when content has any unbreakable
          wide element). */}
      <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        {selectedId === null ? (
          <EmptyState
            bodyMarkdown={empty.body}
            onShowReports={showReportRail ? () => setReportRailOpen(true) : undefined}
          />
        ) : (
          <SelectedItemPane
            kind={kind}
            project={project}
            selectedId={selectedId}
            data={selected.data}
            isLoading={selected.isLoading}
            error={selected.error}
            onShowReports={showReportRail ? () => setReportRailOpen(true) : undefined}
            items={items}
            itemsLoading={itemsLoading}
          />
        )}
      </main>

      {/* Mobile FAB → drawer with the rail */}
      <MobileRailDrawer
        kind={kind}
        project={project}
        items={items}
        itemsLoading={itemsLoading}
        itemsError={itemsError}
        onRetry={refetchItems}
        selectedId={selectedId}
      />
    </div>
  )
}

function useItemsList(
  kind: InboxKind,
  project: ProjectTarget,
): { items: CommonItem[]; isLoading: boolean; error: Error | null; refetch: () => void } {
  const reportsQ = useQuery({
    queryKey: queryKeys.reports(project),
    queryFn: () => fetchReports(project),
    enabled: kind === 'reports',
    staleTime: 5_000,
  })
  const items = useMemo(() => {
    if (kind === 'reports') {
      const reports: ReportListItem[] = reportsQ.data?.reports ?? []
      return reports.map((r) => ({
        id: r.id,
        path: r.path,
        resource: r.resource,
        mtime: r.mtime,
        title: r.title,
        subLabel: r.slug,
      }))
    }
    return []
  }, [kind, reportsQ.data])
  const active = reportsQ
  return {
    items,
    isLoading: active.isLoading,
    error: active.isError ? ((active.error as Error | null) ?? new Error('request failed')) : null,
    refetch: active.refetch,
  }
}

function useSelectedItem(
  kind: InboxKind,
  project: ProjectTarget,
  selectedId: string | null,
): { data: FullItem | undefined; isLoading: boolean; error: Error | null } {
  const reportQ = useQuery({
    queryKey: queryKeys.report(project, selectedId),
    queryFn: () => fetchReport(project, selectedId!),
    enabled: kind === 'reports' && !!selectedId,
  })
  if (kind === 'reports') {
    const r = reportQ.data as FullReport | undefined
    return {
      data: r ? { ...r, subLabel: r.slug } : undefined,
      isLoading: reportQ.isLoading,
      error: (reportQ.error as Error | null) ?? null,
    }
  }
  return { data: undefined, isLoading: false, error: null }
}

function RailHeader({
  kind,
  count,
  onHideReports,
}: {
  kind: InboxKind
  count: number
  onHideReports?: () => void
}) {
  return (
    <div className="flex items-center justify-between border-b px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
      <span>{'Reports'}</span>
      <div className="flex items-center gap-1.5">
        <span className="tabular-nums">{count}</span>
        {onHideReports && <ReportRailToggleButton action="hide" onClick={onHideReports} />}
      </div>
    </div>
  )
}

function ReportRailToggleButton({
  action,
  onClick,
}: {
  action: 'show' | 'hide'
  onClick: () => void
}) {
  const label = action === 'show' ? 'Show reports' : 'Hide reports'
  const Icon = action === 'show' ? PanelLeftOpen : PanelLeftClose
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="normal-case"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Icon />
    </Button>
  )
}

function RailList({
  kind,
  project,
  items,
  selectedId,
  loading,
  error,
  onRetry,
  onSelect,
}: {
  kind: InboxKind
  project: ProjectTarget
  items: CommonItem[]
  selectedId: string | null
  loading: boolean
  error?: Error | null
  onRetry?: () => void
  onSelect?: () => void
}) {
  const base = projectWebPath(project, `/${kind}`)
  if (loading && items.length === 0) {
    return (
      <div className="p-3">
        <ListSkeleton count={4} />
      </div>
    )
  }
  // An errored list must not be indistinguishable from a genuinely empty one.
  // Only blank-slate errors surface here: with stale items cached we keep
  // rendering them instead of wiping the rail.
  if (error && items.length === 0) {
    return (
      <div
        className={cn('flex flex-col items-center gap-2 px-3 py-6 text-center')}
        data-inbox-rail-error=""
      >
        <p className={cn('text-xs font-medium text-destructive')}>{ERROR_COPY[kind].rail}</p>
        <p className={cn('break-words text-[10px] text-muted-foreground')}>{error.message}</p>
        {onRetry && (
          <Button type="button" size="sm" variant="outline" onClick={() => onRetry()}>
            Retry
          </Button>
        )}
      </div>
    )
  }
  if (items.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-xs text-muted-foreground/70">
        {EMPTY_COPY[kind].rail}
      </div>
    )
  }
  return (
    <ul className={cn('flex flex-col', kind === 'reports' && 'gap-1.5 p-2')}>
      {items.map((it) => {
        const active = it.id === selectedId
        return (
          <li key={`${it.id}:${it.path ?? ''}`}>
            <Link
              href={`${base}/${encodeURIComponent(it.id)}`}
              onClick={onSelect}
              aria-current={active ? 'page' : undefined}
              data-report-card={kind === 'reports' ? '' : undefined}
              className={cn(
                kind === 'reports'
                  ? 'block rounded-md border border-border bg-card p-2.5 text-xs transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1'
                  : 'block border-b px-3 py-2 text-xs transition hover:bg-accent/40',
                active &&
                  (kind === 'reports' ? 'border-primary' : 'bg-accent text-accent-foreground'),
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] tabular-nums">{it.id}</span>
                <span className="truncate text-[10px] text-muted-foreground">{it.subLabel}</span>
              </div>
              <div className="mt-0.5 truncate text-[11px]">
                {it.title ?? <span className="italic text-muted-foreground/60">(no title)</span>}
              </div>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

function EmptyState({
  bodyMarkdown,
  onShowReports,
}: {
  bodyMarkdown: string
  onShowReports?: () => void
}) {
  return (
    <div className="flex h-full flex-col">
      {onShowReports && <ClosedReportRailToolbar onShowReports={onShowReports} />}
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="max-w-md text-sm text-muted-foreground">
          <Markdown>{bodyMarkdown}</Markdown>
        </div>
      </div>
    </div>
  )
}

function ClosedReportRailToolbar({ onShowReports }: { onShowReports: () => void }) {
  return (
    <div className="hidden shrink-0 items-center border-b px-3 py-2 md:flex">
      <ReportRailToggleButton action="show" onClick={onShowReports} />
    </div>
  )
}

function SelectedItemPane({
  kind,
  project,
  selectedId,
  data,
  isLoading,
  error,
  onShowReports,
  items,
  itemsLoading,
}: {
  kind: InboxKind
  project: ProjectTarget
  selectedId: string
  data: FullItem | undefined
  isLoading: boolean
  error: Error | null
  onShowReports?: () => void
  items: CommonItem[]
  itemsLoading: boolean
}) {
  const editable = kind === 'reports'
  const [editing, setEditing] = useState(false)

  if (isLoading && !data) {
    return (
      <div className="flex h-full flex-col">
        {onShowReports && <ClosedReportRailToolbar onShowReports={onShowReports} />}
        <div className="p-4 md:p-6">
          <ListSkeleton count={3} />
        </div>
      </div>
    )
  }
  if (error && !data) {
    return (
      <div className="flex h-full flex-col">
        {onShowReports && <ClosedReportRailToolbar onShowReports={onShowReports} />}
        <div className="p-4 text-sm text-destructive">error: {error.message}</div>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="flex h-full flex-col">
        {onShowReports && <ClosedReportRailToolbar onShowReports={onShowReports} />}
        <div className="p-4 text-sm text-muted-foreground">not found: {selectedId}</div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b bg-background/95 px-4 py-2 backdrop-blur">
        <div className="flex min-w-0 items-center gap-2">
          {onShowReports && <ReportRailToggleButton action="show" onClick={onShowReports} />}
          <div className="flex min-w-0 items-baseline gap-2 text-xs">
            <SelectedArtifactIdentity
              key={onShowReports ? 'collapsed' : 'expanded'}
              kind={kind}
              project={project}
              data={data}
              items={items}
              itemsLoading={itemsLoading}
              quickSwitchEnabled={onShowReports !== undefined}
            />
            <span className="text-muted-foreground/60">·</span>
            <TimestampLocal value={new Date(data.mtime).toISOString()} />
          </div>
        </div>
        {editable ? (
          <Button
            size="sm"
            variant={editing ? 'secondary' : 'outline'}
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? <X className="size-3.5" /> : <Pencil className="size-3.5" />}
            {editing ? 'Cancel' : 'Edit'}
          </Button>
        ) : null}
      </div>
      <div className={cn('flex flex-1 overflow-hidden', editing ? 'md:divide-x' : '')}>
        <div
          className={cn(
            'min-w-0 flex-1 overflow-y-auto overflow-x-hidden',
            kind === 'reports' && 'bg-card',
          )}
          data-inbox-reading-surface={kind}
        >
          <div className="p-4 md:p-6">
            <RenderedItem
              kind={kind}
              content={data.content}
              project={project}
              sourceDocumentPath={data.path ?? data.resource}
              sourceSurface={kind === 'reports' ? 'full-report' : 'left'}
              sourceReportId={kind === 'reports' ? selectedId : undefined}
              resourceBaseUrl={
                kind === 'reports' && data.format === 'bundle'
                  ? reportResourceBaseUrl(project, selectedId)
                  : undefined
              }
            />
          </div>
        </div>
        {editable && editing && (
          <div className="hidden md:flex md:w-[28rem] md:flex-col">
            <InboxEditor project={project} data={data} onClose={() => setEditing(false)} />
          </div>
        )}
      </div>

      {/* Mobile: Edit takes over a full-viewport Sheet */}
      {editable && editing && (
        <Sheet open={editing} onOpenChange={setEditing}>
          <SheetContent side="bottom" className="h-[100svh] p-0 md:hidden">
            <SheetHeader className="sr-only">
              <SheetTitle>Edit {data.id}</SheetTitle>
            </SheetHeader>
            <InboxEditor project={project} data={data} onClose={() => setEditing(false)} />
          </SheetContent>
        </Sheet>
      )}
    </div>
  )
}

function SelectedArtifactIdentity({
  kind,
  project,
  data,
  items,
  itemsLoading,
  quickSwitchEnabled,
}: {
  kind: InboxKind
  project: ProjectTarget
  data: FullItem
  items: CommonItem[]
  itemsLoading: boolean
  quickSwitchEnabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const identity = `${data.id} ${data.subLabel}`

  if (kind !== 'reports' || !quickSwitchEnabled) {
    return (
      <>
        <span className="font-mono tabular-nums">{data.id}</span>
        <span className="truncate text-muted-foreground">{data.subLabel}</span>
      </>
    )
  }

  return (
    <>
      <span className="flex min-w-0 items-baseline gap-2 md:hidden" data-report-identity-mobile>
        <span className="font-mono tabular-nums">{data.id}</span>
        <span className="truncate text-muted-foreground">{data.subLabel}</span>
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="hidden h-6 min-w-0 max-w-[min(28rem,45vw)] gap-1.5 px-1.5 md:inline-flex"
            aria-label={`Switch report, current ${identity}`}
            title={identity}
          >
            <span className="shrink-0 font-mono tabular-nums">{data.id}</span>
            <span className="min-w-0 truncate text-muted-foreground">{data.subLabel}</span>
            <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 gap-0 p-0" aria-label="Switch report">
          <div className="flex items-center justify-between border-b px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
            <span>Reports</span>
            <span className="tabular-nums">{items.length}</span>
          </div>
          <div className="max-h-[min(24rem,60vh)] overflow-y-auto" data-report-quick-switch-list>
            <RailList
              kind="reports"
              project={project}
              items={items}
              selectedId={data.id}
              loading={itemsLoading}
              onSelect={() => setOpen(false)}
            />
          </div>
        </PopoverContent>
      </Popover>
    </>
  )
}

export function RenderedItem({
  kind,
  content,
  project,
  resourceBaseUrl,
  sourceDocumentPath,
  sourceSurface,
  sourceReportId,
}: {
  kind: InboxKind
  content: string
  project: ProjectTarget
  resourceBaseUrl?: string
  sourceDocumentPath?: string
  sourceSurface?: 'left' | 'full-report' | 'side-report'
  sourceReportId?: string
}) {
  const { frontmatter, body } = useMemo(() => splitFrontmatter(content), [content])
  const rendered = (
    <>
      {frontmatter && (
        <FrontmatterPanel
          data={frontmatter}
          timestampKeys={kind === 'reports' ? REPORT_TIMESTAMP_KEYS : undefined}
        />
      )}
      {kind === 'reports' ? (
        <BodyTranslation
          document={{
            host: projectHost(project) ?? undefined,
            project: projectName(project),
            kind: 'report',
            id: sourceReportId ?? '',
          }}
          sources={translationSources('report', { content })}
        >
          <ReportHtmlZoomProvider>
            <Markdown
              project={project}
              resourceBaseUrl={resourceBaseUrl}
              tableOfContents={{ headingIdPrefix: `report-${sourceReportId ?? 'document'}` }}
              document={
                sourceDocumentPath
                  ? {
                      project: projectName(project),
                      host: projectHost(project) ?? undefined,
                      path: sourceDocumentPath,
                    }
                  : undefined
              }
            >
              {body}
            </Markdown>
          </ReportHtmlZoomProvider>
        </BodyTranslation>
      ) : (
        <Markdown
          project={project}
          resourceBaseUrl={resourceBaseUrl}
          document={
            sourceDocumentPath
              ? {
                  project: projectName(project),
                  host: projectHost(project) ?? undefined,
                  path: sourceDocumentPath,
                }
              : undefined
          }
        >
          {body}
        </Markdown>
      )}
    </>
  )
  return sourceDocumentPath && sourceSurface ? (
    <DocumentArtifactLinkProvider
      project={project}
      sourceDocumentPath={sourceDocumentPath}
      sourceSurface={sourceSurface}
      sourceReportId={sourceReportId}
    >
      {rendered}
    </DocumentArtifactLinkProvider>
  ) : (
    rendered
  )
}

export function reportResourceBaseUrl(project: ProjectTarget, reportId: string): string {
  const base = `/api/report-assets/${encodeURIComponent(projectName(project))}/${encodeURIComponent(reportId)}`
  const host = projectHost(project)
  return host
    ? `${base}?host=${encodeURIComponent(host)}&project=${encodeURIComponent(projectName(project))}`
    : base
}

/** Report editor. */
function InboxEditor({
  project,
  data,
  onClose,
}: {
  project: ProjectTarget
  data: FullItem
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [buffer, setBuffer] = useState(data.content)
  const [saving, setSaving] = useState(false)
  const [knownMtime, setKnownMtime] = useState(data.mtime)
  const [knownHash, setKnownHash] = useState(data.hash)

  // If the underlying data updates externally (SSE invalidation), pick up
  // the new on-disk state so subsequent saves pass the optimistic-lock check.
  useEffect(() => {
    setKnownMtime(data.mtime)
    setKnownHash(data.hash)
  }, [data.mtime, data.hash])

  async function save() {
    setSaving(true)
    const detailKey = queryKeys.report(project, data.id)
    try {
      const res = await putReport(project, data.id, {
        content: buffer,
        expectedMtime: knownMtime,
        expectedHash: knownHash,
      })
      // Update local editor state to the post-write mtime/hash so the next
      // save doesn't immediately conflict.
      setKnownMtime(res.mtime)
      setKnownHash(res.hash)
      // Invalidate the detail query so the rendered pane reflects the save.
      queryClient.invalidateQueries({ queryKey: detailKey })
      queryClient.invalidateQueries({ queryKey: queryKeys.reports(project) })
      toast.success('saved')
      onClose()
    } catch (err) {
      const e = err as { status?: number; message?: string }
      if (e?.status === 409) {
        toast.error('External edit detected. Refresh to load the latest content.', {
          action: {
            label: 'Refresh',
            onClick: () => {
              queryClient.invalidateQueries({ queryKey: detailKey })
              onClose()
            },
          },
        })
      } else {
        toast.error(`save failed: ${e?.message ?? 'unknown'}`)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2 text-xs">
        <span className="font-mono text-muted-foreground">edit · {data.id}</span>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={saving || buffer === data.content}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
      <div className="flex-1">
        <ReadmeMonaco value={buffer} onChange={setBuffer} />
      </div>
    </div>
  )
}

function MobileRailDrawer({
  kind,
  project,
  items,
  itemsLoading,
  itemsError,
  onRetry,
  selectedId,
}: {
  kind: InboxKind
  project: ProjectTarget
  items: CommonItem[]
  itemsLoading: boolean
  itemsError?: Error | null
  onRetry?: () => void
  selectedId: string | null
}) {
  const [open, setOpen] = useState(false)
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          size="icon"
          className="fixed right-6 bottom-6 z-30 size-12 rounded-full shadow-lg md:hidden"
          aria-label="Open list"
        >
          <List className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-80 p-0">
        <SheetHeader className="border-b px-3 py-3">
          <SheetTitle className="text-sm">
            {'Reports'} · {projectHost(project) ? `${projectHost(project)}/` : ''}
            {projectName(project)}
          </SheetTitle>
        </SheetHeader>
        <RailList
          kind={kind}
          project={project}
          items={items}
          selectedId={selectedId}
          loading={itemsLoading}
          error={itemsError}
          onRetry={onRetry}
          onSelect={() => setOpen(false)}
        />
      </SheetContent>
    </Sheet>
  )
}
