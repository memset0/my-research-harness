'use client'
import { translationSources } from '../lib/translation/sources'
import { BodyTranslation } from './body-translation'

// Inbox shell for the per-project Reports view.
// Desktop: 2-column read mode (rail + rendered) → 3-column when editing
// (rail + rendered + Monaco). Mobile: rendered only with a FAB that opens
// a right-side Sheet showing the rail; tapping Edit opens a full-viewport
// bottom Sheet with Monaco.

import type { ContentFields } from '@memon/core'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, X } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  type FullReport,
  fetchReport,
  fetchReports,
  isNotRefreshed,
  type ProjectTarget,
  projectHost,
  projectName,
  projectRouteTarget,
  putReport,
  type ReportListItem,
} from '../lib/api'
import { canonicalReportHref } from '../lib/artifact-navigation'
import { splitFrontmatter } from '../lib/frontmatter'
import { projectPagePath } from '../lib/project-routes'
import { queryKeys } from '../lib/query-keys'
import { cn } from '../lib/utils'
import {
  ContentBadges,
  ContentFilters,
  ContentPresentation,
  emptyContentFilter,
  matchesContentFilter,
  ServiceAvailability,
} from './content-presentation'
import { DocumentArtifactLinkProvider } from './document-artifact-link-provider'
import { DocumentHeader } from './document-header'
import { FrontmatterPanel } from './frontmatter-panel'
import { Markdown } from './markdown'
import { ReadmeMonaco } from './readme-monaco'
import { ReportHtmlHostContext, ReportHtmlZoomProvider } from './report-html-embed'
import { useIsDocumentOnlyViewer } from './session-provider'
import { ListSkeleton } from './skeletons'
import { Button } from './ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet'

export type InboxKind = 'reports'

interface CommonItem extends ContentFields {
  id: string
  path?: string
  resource?: string
  mtime: number
  title: string | null
  /** Report slug sub-label. */
  subLabel: string
}

interface FullItem extends ContentFields {
  id: string
  path?: string
  resource?: string
  mtime: number
  hash: string
  content: string
  subLabel: string
  title?: string
  format?: 'markdown' | 'bundle'
}

const EMPTY_COPY = {
  reports: {
    rail: 'no reports yet',
    body: 'No reports yet. Reports are written by `memon-write-report`; pick a research question or set of experiments and ask the skill to summarize.',
  },
} as const

const ERROR_COPY = {
  reports: { rail: 'failed to load reports' },
} as const

const REPORT_TIMESTAMP_KEYS = ['created_at', 'updated_at'] as const

export function InboxShell({
  kind,
  project,
  selectedId,
}: {
  kind: InboxKind
  project: ProjectTarget
  selectedId: string | null
}) {
  // A document-only share viewer sees the shared Report without the picker.
  const documentOnly = useIsDocumentOnlyViewer()
  const {
    items: allItems,
    isLoading: itemsLoading,
    error: itemsError,
    refetch: refetchItems,
  } = useItemsList(kind, project, !documentOnly)
  const [contentFilter, setContentFilter] = useState(emptyContentFilter)
  const items = allItems.filter((item) => matchesContentFilter(item, contentFilter))
  const contentFilters = (
    <ContentFilters items={allItems} value={contentFilter} onChange={setContentFilter} />
  )
  const selected = useSelectedItem(kind, project, selectedId)

  // Navigation lives in the sidebar; the Report list page is a filterable
  // card index and a Report page uses the whole width.
  return (
    <div className="flex h-full overflow-hidden">
      <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        {selectedId === null ? (
          <ReportIndex
            kind={kind}
            project={project}
            filters={contentFilters}
            items={items}
            totalCount={allItems.length}
            loading={itemsLoading}
            error={itemsError}
            onRetry={refetchItems}
            emptyBody={EMPTY_COPY[kind].body}
          />
        ) : (
          <SelectedItemPane
            kind={kind}
            project={project}
            selectedId={selectedId}
            data={selected.data}
            isLoading={selected.isLoading}
            error={selected.error}
          />
        )}
      </main>
    </div>
  )
}

function useItemsList(
  kind: InboxKind,
  project: ProjectTarget,
  enabled = true,
): { items: CommonItem[]; isLoading: boolean; error: Error | null; refetch: () => void } {
  const reportsQ = useQuery({
    queryKey: queryKeys.reports(project),
    queryFn: () => fetchReports(project),
    enabled: enabled && kind === 'reports',
    staleTime: 5_000,
  })
  const items = useMemo(() => {
    if (kind === 'reports') {
      const reports: ReportListItem[] = reportsQ.data?.reports ?? []
      return reports.map((r) => ({
        ...r,
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

/** A Report's page; an id outside the `R<NNNN>` scheme opens the Report list. */
function reportItemHref(project: ProjectTarget, id: string): string {
  return /^R\d{4}$/.test(id)
    ? canonicalReportHref(project, id)
    : projectPagePath(projectRouteTarget(project), { kind: 'reports' })
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
  layout = 'list',
}: {
  kind: InboxKind
  project: ProjectTarget
  items: CommonItem[]
  selectedId: string | null
  loading: boolean
  error?: Error | null
  onRetry?: () => void
  onSelect?: () => void
  /** `grid` on the list page; `list` (one column) in the quick switcher. */
  layout?: 'grid' | 'list'
}) {
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
    <ul
      className={cn(
        'grid',
        layout === 'grid' ? 'gap-3 sm:grid-cols-2 xl:grid-cols-3' : 'gap-1.5 p-2',
      )}
      data-report-index-grid={layout === 'grid' ? '' : undefined}
    >
      {items.map((it) => {
        const active = it.id === selectedId
        return (
          <li key={`${it.id}:${it.path ?? ''}`}>
            <Link
              href={reportItemHref(project, it.id)}
              onClick={onSelect}
              aria-current={active ? 'page' : undefined}
              data-report-card={kind === 'reports' ? '' : undefined}
              className={cn(
                kind === 'reports'
                  ? 'flex h-full flex-col rounded-lg border border-border bg-card p-3 text-xs transition-colors hover:border-primary/60 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1'
                  : 'block border-b px-3 py-2 text-xs transition hover:bg-accent/40',
                active &&
                  (kind === 'reports' ? 'border-primary' : 'bg-accent text-accent-foreground'),
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] tabular-nums">{it.id}</span>
                <span className="truncate text-[10px] text-muted-foreground">{it.subLabel}</span>
              </div>
              <div className="mt-1.5 text-sm font-medium leading-snug">
                {it.title ?? <span className="italic text-muted-foreground/60">(no title)</span>}
              </div>
              {it.description && (
                <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{it.description}</p>
              )}
              <div className="mt-auto pt-2">
                <ContentBadges content={it} />
              </div>
            </Link>
            {it.presentation === 'service' && (
              <ServiceAvailability project={project} kind="report" id={it.id} />
            )}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * The Report list page: the content filters over a card per Report. The
 * authoring empty copy shows only when the list loaded and is empty.
 */
function ReportIndex({
  kind,
  project,
  filters,
  items,
  totalCount,
  loading,
  error,
  onRetry,
  emptyBody,
}: {
  kind: InboxKind
  project: ProjectTarget
  filters: React.ReactNode
  items: CommonItem[]
  totalCount: number
  loading: boolean
  error: Error | null
  onRetry: () => void
  emptyBody: string
}) {
  if (!loading && !error && totalCount === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md text-sm text-muted-foreground" data-inbox-empty-state="">
          <Markdown>{emptyBody}</Markdown>
        </div>
      </div>
    )
  }
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 md:p-6" data-report-index="">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-lg font-semibold">
          Reports{' '}
          <span className="text-sm font-normal tabular-nums text-muted-foreground">
            {items.length === totalCount ? totalCount : `${items.length} / ${totalCount}`}
          </span>
        </h1>
        <div className="w-full sm:w-[28rem]">{filters}</div>
      </div>
      <RailList
        layout="grid"
        kind={kind}
        project={project}
        items={items}
        selectedId={null}
        loading={loading}
        error={error}
        onRetry={onRetry}
      />
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
}: {
  kind: InboxKind
  project: ProjectTarget
  selectedId: string
  data: FullItem | undefined
  isLoading: boolean
  error: Error | null
}) {
  const editable = kind === 'reports'
  const [editing, setEditing] = useState(false)
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null)

  if (isLoading && !data) {
    return (
      <div className="flex h-full flex-col">
        <div className="p-4 md:p-6">
          <ListSkeleton count={3} />
        </div>
      </div>
    )
  }
  if (error && !data) {
    return (
      <div className="flex h-full flex-col">
        {isNotRefreshed(error) ? (
          <div className="p-4 text-sm text-muted-foreground" data-not-refreshed="">
            Not refreshed: {selectedId}
          </div>
        ) : (
          <div className="p-4 text-sm text-destructive">error: {error.message}</div>
        )}
      </div>
    )
  }
  if (!data) {
    return (
      <div className="flex h-full flex-col">
        <div className="p-4 text-sm text-muted-foreground">not found: {selectedId}</div>
      </div>
    )
  }

  // An HTML or service Report is one embed: no editor, no padding, and the
  // embed's controls sit in the header.
  const isApp =
    !data.contentError && (data.presentation === 'html' || data.presentation === 'service')
  const header = (
    <DocumentHeader
      id={data.id}
      title={data.title || data.subLabel}
      slug={data.subLabel}
      updatedAt={data.updatedAt ?? new Date(data.mtime).toISOString()}
      createdAt={data.createdAt}
      content={data}
      project={project}
      kind="report"
      actions={
        isApp ? (
          <div ref={setToolbarSlot} className="flex items-center" data-embed-toolbar-slot="" />
        ) : editable ? (
          <Button
            size="sm"
            variant={editing ? 'secondary' : 'outline'}
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? <X className="size-3.5" /> : <Pencil className="size-3.5" />}
            {editing ? 'Cancel' : 'Edit'}
          </Button>
        ) : null
      }
    />
  )
  if (isApp)
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="flex min-h-0 flex-1 flex-col" data-inbox-reading-surface={kind}>
          <ReportHtmlHostContext.Provider value={{ toolbarSlot }}>
            <ContentPresentation
              content={data}
              project={project}
              kind="report"
              id={selectedId}
              expandInUrl
            />
          </ReportHtmlHostContext.Provider>
        </div>
      </div>
    )

  return (
    <div className="flex h-full flex-col">
      {header}
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
              metadata={data}
              project={project}
              sourceDocumentPath={data.path ?? data.resource}
              reportId={kind === 'reports' ? selectedId : undefined}
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

export function RenderedItem({
  kind,
  content,
  project,
  resourceBaseUrl,
  sourceDocumentPath,
  reportId,
  metadata,
}: {
  kind: InboxKind
  metadata?: ContentFields
  content: string
  project: ProjectTarget
  resourceBaseUrl?: string
  sourceDocumentPath?: string
  reportId?: string
}) {
  const { frontmatter, body } = useMemo(() => splitFrontmatter(content), [content])
  if (
    metadata?.presentation === 'html' ||
    metadata?.presentation === 'service' ||
    metadata?.contentError
  )
    return (
      <div>
        <ContentPresentation
          content={metadata}
          project={project}
          kind="report"
          id={reportId ?? ''}
          expandInUrl
        />
      </div>
    )
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
            id: reportId ?? '',
          }}
          sources={translationSources('report', { content })}
        >
          <ReportHtmlZoomProvider>
            <Markdown
              project={project}
              resourceBaseUrl={resourceBaseUrl}
              tableOfContents={{ headingIdPrefix: `report-${reportId ?? 'document'}` }}
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
  return sourceDocumentPath ? (
    <DocumentArtifactLinkProvider project={project} sourceDocumentPath={sourceDocumentPath}>
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
