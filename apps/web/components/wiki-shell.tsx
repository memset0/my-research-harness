'use client'
import { translationSources } from '../lib/translation/sources'
import { BodyTranslation } from './body-translation'

// Per-project wiki surface.
//
// Desktop: reading surface | sticky outline column | rail (flat card list,
// newest edit first). Activating Edit swaps the outline column for Monaco.
// Mobile: reading surface only, with a FAB that opens the same card list in a
// right-side Sheet and a full-viewport bottom Sheet for editing.

import type { WikiDiagnostic } from '@memon/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, X } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  ApiError,
  fetchWiki,
  fetchWikiPage,
  isNotRefreshed,
  type ProjectTarget,
  projectHost,
  projectName,
  projectRouteTarget,
  putWikiPage,
  type WikiListItem,
  type WikiPageDetail,
} from '../lib/api'
import { canonicalWikiHref } from '../lib/artifact-navigation'
import { setChecklistStatus } from '../lib/components/checklist/v1/update'
import {
  type ChecklistToggle,
  type ChecklistWriteContextValue,
  ChecklistWriteProvider,
} from '../lib/components/checklist/v1/write-context'
import { splitFrontmatter } from '../lib/frontmatter'
import {
  extractMarkdownOutline,
  type MarkdownOutlineEntry,
  normalizeHeadingIdPrefix,
} from '../lib/markdown-outline'
import { projectPagePath } from '../lib/project-routes'
import { queryKeys } from '../lib/query-keys'
import {
  handleFragmentClick,
  resetDriftedAncestors,
  scrollFragmentIntoSurface,
} from '../lib/scroll-to-fragment'
import { cn } from '../lib/utils'
import { wikiKinds } from '../lib/wiki-kinds'
import {
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
import { useIsDocumentOnlyViewer, useIsOwner } from './session-provider'
import { ListSkeleton } from './skeletons'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet'
import { WikiKindHelp } from './wiki-kind-help'
import {
  filterWikiPages,
  sortWikiPages,
  WIKI_KIND_ORDER,
  WikiDeprecatedBadge,
  WikiKindBadge,
  WikiPageCard,
  WikiStaleIndicator,
  WikiStatusBadge,
} from './wiki-page-card'

const WIKI_TIMESTAMP_KEYS = ['created_at', 'updated_at', 'date'] as const

const EMPTY_BODY =
  'No wiki pages yet. Pages are written by the `memon-wiki` skill, or from the shell with `memon wiki create <kind> <slug> --title "…"`.'

/** Asset endpoint for a bundle-form page, mirroring `reportResourceBaseUrl`. */
/** A wiki page's page; a value outside the `W<NNNN>` scheme opens the wiki list. */
function wikiItemHref(project: ProjectTarget, id: string): string {
  return /^W\d{4}$/.test(id)
    ? canonicalWikiHref(project, id)
    : projectPagePath(projectRouteTarget(project), { kind: 'wiki-list' })
}

export function wikiResourceBaseUrl(project: ProjectTarget, wikiId: string): string {
  const base = `/api/wiki-assets/${encodeURIComponent(projectName(project))}/${encodeURIComponent(wikiId)}`
  const host = projectHost(project)
  return host
    ? `${base}?host=${encodeURIComponent(host)}&project=${encodeURIComponent(projectName(project))}`
    : base
}

export function useWikiPages(project: ProjectTarget, enabled = true) {
  const query = useQuery({
    queryKey: queryKeys.wiki(project),
    queryFn: () => fetchWiki(project),
    staleTime: 5_000,
    enabled,
  })
  const pages = useMemo(() => sortWikiPages(query.data?.pages ?? []), [query.data])
  return {
    pages,
    isLoading: query.isLoading,
    error: query.isError ? ((query.error as Error | null) ?? new Error('request failed')) : null,
    refetch: query.refetch,
  }
}

export function WikiShell({
  project,
  selectedId,
}: {
  project: ProjectTarget
  selectedId: string | null
}) {
  // A document-only share viewer sees the shared page without the page list.
  const documentOnly = useIsDocumentOnlyViewer()
  const { pages, isLoading, error, refetch } = useWikiPages(project, !documentOnly)
  const [contentFilter, setContentFilter] = useState(emptyContentFilter)
  const [kindFilter, setKindFilter] = useState('all')
  const [textFilter, setTextFilter] = useState('')
  const visible = useMemo(
    () =>
      filterWikiPages(pages, { kind: kindFilter, text: textFilter }).filter((page) =>
        matchesContentFilter(page, contentFilter),
      ),
    [pages, kindFilter, textFilter, contentFilter],
  )

  const detail = useQuery({
    queryKey: queryKeys.wikiPage(project, selectedId),
    queryFn: () => fetchWikiPage(project, selectedId!),
    enabled: selectedId !== null,
  })

  // Navigation lives in the sidebar; the Wiki list page is a filterable card
  // index and a Wiki page uses the whole width.
  return (
    <div className="flex h-full overflow-hidden">
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {selectedId === null ? (
          <WikiIndex
            project={project}
            pages={pages}
            visible={visible}
            isLoading={isLoading}
            error={error}
            onRetry={refetch}
            filtered={
              textFilter.trim() !== '' || kindFilter !== 'all' || visible.length !== pages.length
            }
            filters={
              <div className="flex flex-col gap-2">
                <ContentFilters items={pages} value={contentFilter} onChange={setContentFilter} />
                <WikiRailFilters
                  kind={kindFilter}
                  text={textFilter}
                  kinds={pages}
                  onKindChange={setKindFilter}
                  onTextChange={setTextFilter}
                />
              </div>
            }
          />
        ) : (
          <WikiSelectedPane
            project={project}
            selectedId={selectedId}
            page={detail.data}
            isLoading={detail.isLoading}
            error={(detail.error as Error | null) ?? null}
          />
        )}
      </main>
    </div>
  )
}

function WikiRailFilters({
  kind,
  text,
  kinds,
  onKindChange,
  onTextChange,
}: {
  kind: string
  text: string
  kinds: readonly WikiListItem[]
  onKindChange: (next: string) => void
  onTextChange: (next: string) => void
}) {
  // Unknown kinds are discovered from directory names, so the options are the
  // canonical order plus whatever else the project actually contains.
  const present = new Set(kinds.map((page) => page.kind))
  const options = [
    ...WIKI_KIND_ORDER.filter((known) => present.has(known)),
    ...[...present].filter((value) => !WIKI_KIND_ORDER.includes(value)).sort(),
  ]
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="flex flex-col gap-1">
        <Label htmlFor="wiki-kind-filter" className="text-[10px] uppercase text-muted-foreground">
          Kind
        </Label>
        <Select value={kind} onValueChange={onKindChange}>
          <SelectTrigger
            id="wiki-kind-filter"
            size="sm"
            className="w-full"
            data-slot="wiki-kind-filter"
          >
            <SelectValue placeholder="all kinds" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">all kinds</SelectItem>
            {options.map((option) => (
              <SelectItem key={option} value={option}>
                {wikiKinds.find((entry) => entry.id === option)?.label ?? option} ({option})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="wiki-text-filter" className="text-[10px] uppercase text-muted-foreground">
          Filter
        </Label>
        <div className="relative">
          <Input
            id="wiki-text-filter"
            value={text}
            onChange={(event) => onTextChange(event.target.value)}
            placeholder="title, slug, or tag"
            className="h-8 pr-8 text-xs"
            data-slot="wiki-text-filter"
          />
          {text !== '' && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute top-0 right-0 h-8 w-8"
              aria-label="Clear wiki page filter"
              onClick={() => onTextChange('')}
            >
              <X className="size-3" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function WikiCardList({
  project,
  pages,
  selectedId,
  loading,
  error,
  onRetry,
  filtered,
  onSelect,
  layout = 'list',
}: {
  project: ProjectTarget
  pages: readonly WikiListItem[]
  selectedId: string | null
  loading: boolean
  error?: Error | null
  onRetry?: () => void
  filtered: boolean
  onSelect?: () => void
  /** `grid` on the list page; `list` (one column) in the quick switcher. */
  layout?: 'grid' | 'list'
}) {
  if (loading && pages.length === 0) {
    return (
      <div className="p-3">
        <ListSkeleton count={4} />
      </div>
    )
  }
  // A failed list must stay distinguishable from a genuinely empty one.
  if (error && pages.length === 0) {
    return (
      <div
        className="flex flex-col items-center gap-2 px-3 py-6 text-center"
        data-wiki-rail-error=""
      >
        <p className="text-xs font-medium text-destructive">failed to load wiki pages</p>
        <p className="break-words text-[10px] text-muted-foreground">{error.message}</p>
        {onRetry && (
          <Button type="button" size="sm" variant="outline" onClick={() => onRetry()}>
            Retry
          </Button>
        )}
      </div>
    )
  }
  if (pages.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-xs text-muted-foreground/70">
        {filtered ? 'no matching pages' : 'no pages yet'}
      </div>
    )
  }
  return (
    <ul
      className={cn(
        'grid',
        layout === 'grid' ? 'gap-3 sm:grid-cols-2 xl:grid-cols-3' : 'gap-1.5 p-2',
      )}
      data-wiki-index-grid={layout === 'grid' ? '' : undefined}
    >
      {pages.map((page) => (
        <li key={page.id} className="flex flex-col gap-1">
          <WikiPageCard
            page={page}
            href={wikiItemHref(project, page.id)}
            active={page.id === selectedId}
            onSelect={onSelect}
          />
          {page.presentation === 'service' && (
            <ServiceAvailability project={project} kind="wiki" id={page.id} />
          )}
        </li>
      ))}
    </ul>
  )
}

/**
 * The Wiki list page: filters over a card per page. The authoring empty copy
 * shows only when the list loaded and is empty.
 */
function WikiIndex({
  project,
  pages,
  visible,
  isLoading,
  error,
  onRetry,
  filtered,
  filters,
}: {
  project: ProjectTarget
  pages: readonly WikiListItem[]
  visible: readonly WikiListItem[]
  isLoading: boolean
  error: Error | null
  onRetry: () => void
  filtered: boolean
  filters: React.ReactNode
}) {
  if (!isLoading && !error && pages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md text-sm text-muted-foreground" data-wiki-empty-state="">
          <Markdown>{EMPTY_BODY}</Markdown>
        </div>
      </div>
    )
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 md:p-6" data-wiki-index="">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            Wiki
            <span className="text-sm font-normal tabular-nums text-muted-foreground">
              {visible.length === pages.length
                ? pages.length
                : `${visible.length} / ${pages.length}`}
            </span>
            <WikiKindHelp />
          </h1>
          <div className="w-full sm:w-[28rem]">{filters}</div>
        </div>
        <WikiCardList
          layout="grid"
          project={project}
          pages={visible}
          selectedId={null}
          loading={isLoading}
          error={error}
          onRetry={onRetry}
          filtered={filtered}
        />
      </div>
    </div>
  )
}

function WikiSelectedPane({
  project,
  selectedId,
  page,
  isLoading,
  error,
}: {
  project: ProjectTarget
  selectedId: string
  page: WikiPageDetail | undefined
  isLoading: boolean
  error: Error | null
}) {
  const [editing, setEditing] = useState(false)
  const [widthLimited, setWidthLimited] = useState(true)
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null)
  const notFound = (error as (Error & { status?: number }) | null)?.status === 404

  if (isLoading && !page) {
    return (
      <div className="flex h-full flex-col">
        <div className="p-4 md:p-6">
          <ListSkeleton count={3} />
        </div>
      </div>
    )
  }
  // A page already on screen survives a failed refresh; only an empty pane
  // reports the failure.
  if (!page) {
    return (
      <div className="flex h-full flex-col">
        <div className="p-4 text-sm" data-wiki-not-found="">
          {isNotRefreshed(error) ? (
            <span className="text-muted-foreground" data-not-refreshed="">
              Not refreshed: {selectedId}
            </span>
          ) : error && !notFound ? (
            <span className="text-destructive">error: {error.message}</span>
          ) : (
            <span className="text-muted-foreground">not found: {selectedId}</span>
          )}
        </div>
      </div>
    )
  }

  const outline = extractMarkdownOutline(splitFrontmatter(page.content).body, {
    headingIdPrefix: `wiki-${page.id}`,
  })

  // An HTML or service page is one embed: no editor or width toggle, no
  // padding, and the embed's controls sit in the header.
  const isApp =
    !page.contentError && (page.presentation === 'html' || page.presentation === 'service')
  const header = (
    <DocumentHeader
      id={page.id}
      title={page.title || page.slug}
      slug={page.slug}
      updatedAt={page.updatedAt}
      createdAt={page.createdAt}
      content={page}
      project={project}
      kind="wiki"
      actions={
        isApp ? (
          <div ref={setToolbarSlot} className="flex items-center" data-embed-toolbar-slot="" />
        ) : (
          <>
            <WikiKindHelp />
            <Button
              size="sm"
              variant="outline"
              aria-label="Limit reading width to 800px"
              aria-pressed={widthLimited}
              title={widthLimited ? 'Use full width' : 'Limit reading width to 800px'}
              onClick={() => setWidthLimited((value) => !value)}
            >
              {widthLimited ? '800px' : 'Full width'}
            </Button>
            <Button
              size="sm"
              variant={editing ? 'secondary' : 'outline'}
              onClick={() => setEditing((value) => !value)}
            >
              {editing ? <X className="size-3.5" /> : <Pencil className="size-3.5" />}
              {editing ? 'Cancel' : 'Edit'}
            </Button>
          </>
        )
      }
    />
  )
  if (isApp)
    return (
      <div className="flex h-full min-h-0 flex-col">
        {header}
        <div className="flex min-h-0 flex-1 flex-col" data-wiki-reading-surface="">
          {page.diagnostics.length > 0 && (
            <div className="px-4 pt-3">
              <WikiDiagnosticsBlock diagnostics={page.diagnostics} />
            </div>
          )}
          <ReportHtmlHostContext.Provider value={{ toolbarSlot }}>
            <ContentPresentation
              content={page}
              project={project}
              kind="wiki"
              id={page.id}
              expandInUrl
            />
          </ReportHtmlHostContext.Provider>
        </div>
      </div>
    )

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden"
          data-wiki-reading-surface=""
        >
          <div className="flex justify-center gap-6 p-4 md:p-6" data-wiki-reading-layout="">
            <div
              className={cn(
                'min-w-0 flex-1 bg-card p-4 md:p-6',
                widthLimited &&
                  page.presentation !== 'html' &&
                  page.presentation !== 'service' &&
                  'max-w-[800px]',
              )}
              data-wiki-document-column=""
            >
              <WikiDocumentView project={project} page={page} widthLimited={widthLimited} />
              <WikiFragmentDeepLink pageId={page.id} />
            </div>
            {!editing && outline.length > 0 && (
              <nav
                aria-label="Table of contents"
                className="sticky top-6 hidden max-h-[calc(100svh-12rem)] w-60 shrink-0 self-start overflow-y-auto overflow-x-hidden border-l p-3 md:block has-[details:not([open])]:w-auto"
                data-wiki-outline=""
              >
                {/* A native disclosure: collapsing hides the entries and lets
                    the column shrink to its title. */}
                <details open>
                  <summary className="mb-2 cursor-pointer select-none text-[10px] uppercase tracking-wide text-muted-foreground">
                    On this page
                  </summary>
                  <WikiOutlineList entries={outline} />
                </details>
              </nav>
            )}
          </div>
        </div>

        {editing && (
          <div className="hidden md:flex md:w-[28rem] md:flex-col md:border-l">
            <WikiEditor project={project} page={page} onClose={() => setEditing(false)} />
          </div>
        )}
      </div>

      {editing && (
        <Sheet open={editing} onOpenChange={setEditing}>
          <SheetContent side="bottom" className="h-[100svh] p-0 md:hidden">
            <SheetHeader className="sr-only">
              <SheetTitle>Edit {page.id}</SheetTitle>
            </SheetHeader>
            <WikiEditor project={project} page={page} onClose={() => setEditing(false)} />
          </SheetContent>
        </Sheet>
      )}
    </div>
  )
}

function WikiOutlineList({ entries }: { entries: readonly MarkdownOutlineEntry[] }) {
  const minDepth = Math.min(...entries.map((entry) => entry.depth))
  return (
    <ul className="flex flex-col gap-1 text-xs">
      {entries.map((entry) => (
        <li key={entry.id} style={{ paddingLeft: `${(entry.depth - minDepth) * 0.75}rem` }}>
          <a
            href={`#${entry.id}`}
            onClick={(event) => handleFragmentClick(event, `#${entry.id}`)}
            className="block truncate text-muted-foreground transition-colors hover:text-foreground"
          >
            {entry.label}
          </a>
        </li>
      ))}
    </ul>
  )
}

/**
 * Positions the heading named by the URL fragment inside the reading surface
 * once the page body is mounted. The browser's own load-time hash scroll has
 * already dragged the non-scrollable ancestors, so those are reset too.
 */
function WikiFragmentDeepLink({ pageId }: { pageId: string }) {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1))
    if (!id.startsWith(normalizeHeadingIdPrefix(`wiki-${pageId}`))) return
    const surface = document.querySelector('[data-wiki-reading-surface]')
    if (surface) resetDriftedAncestors(surface)
    scrollFragmentIntoSurface(id)
  }, [pageId])
  return null
}

export function WikiDocumentView({
  project,
  page,
  widthLimited = true,
}: {
  project: ProjectTarget
  page: WikiPageDetail
  widthLimited?: boolean
}) {
  const { frontmatter, body } = useMemo(() => splitFrontmatter(page.content), [page.content])
  // Checklist edits use source-file lines, including the frontmatter block.
  const bodyStartLine = useMemo(
    () => page.content.slice(0, page.content.length - body.length).split('\n').length,
    [body, page.content],
  )
  const checklistWrite = useWikiChecklistWrite(project, page, bodyStartLine)
  const componentDocumentPath = page.resource ?? page.path
  const componentDocument = componentDocumentPath
    ? {
        project: projectName(project),
        host: projectHost(project) ?? undefined,
        path: componentDocumentPath,
      }
    : undefined

  if (page.presentation === 'html' || page.presentation === 'service' || page.contentError) {
    return (
      <div>
        <WikiDiagnosticsBlock diagnostics={page.diagnostics} />
        <ContentPresentation
          content={page}
          project={project}
          kind="wiki"
          id={page.id}
          expandInUrl
        />
      </div>
    )
  }
  return (
    <DocumentArtifactLinkProvider project={project} sourceDocumentPath={page.resource ?? page.path}>
      {page.deprecated && (
        <div
          className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive"
          data-wiki-deprecated-banner=""
        >
          <span className="font-medium">Deprecated {page.deprecated.at}</span> —{' '}
          {page.deprecated.reason}
          {page.deprecated.superseded_by && (
            <>
              {' '}
              Superseded by{' '}
              <Link
                href={wikiItemHref(project, page.deprecated.superseded_by)}
                className="underline"
              >
                {page.deprecated.superseded_by}
              </Link>
              .
            </>
          )}
        </div>
      )}

      {frontmatter && <FrontmatterPanel data={frontmatter} timestampKeys={WIKI_TIMESTAMP_KEYS} />}

      <WikiDiagnosticsBlock diagnostics={page.diagnostics} />

      <div
        className={cn('mx-auto w-full', widthLimited && 'max-w-[800px]')}
        data-wiki-document-body=""
        lang={page.language === 'zh' ? 'zh-CN' : 'en'}
      >
        <BodyTranslation
          document={{
            host: projectHost(project) ?? undefined,
            project: projectName(project),
            kind: 'wiki',
            id: page.id,
          }}
          sources={translationSources('wiki', page)}
          sourceLanguage={page.language === 'zh' ? 'zh' : 'en'}
        >
          <ReportHtmlZoomProvider>
            <ChecklistWriteProvider value={checklistWrite}>
              <Markdown
                project={project}
                resourceBaseUrl={
                  page.format === 'bundle' ? wikiResourceBaseUrl(project, page.id) : undefined
                }
                headingIdPrefix={`wiki-${page.id}`}
                document={componentDocument}
              >
                {body}
              </Markdown>
            </ChecklistWriteProvider>
          </ReportHtmlZoomProvider>
        </BodyTranslation>
      </div>
    </DocumentArtifactLinkProvider>
  )
}

/**
 * Persists one checklist flag by rewriting the page through the ordinary
 * page write (mtime/hash lock). Nothing is shown as checked until the server
 * has accepted the new file; a conflict offers reload instead of retrying.
 */
function useWikiChecklistWrite(
  project: ProjectTarget,
  page: WikiPageDetail,
  bodyStartLine: number,
): ChecklistWriteContextValue {
  const queryClient = useQueryClient()
  const isOwner = useIsOwner()
  const detailKey = useMemo(() => queryKeys.wikiPage(project, page.id), [project, page.id])
  const mutation = useMutation({
    mutationFn: (edit: ChecklistToggle) =>
      putWikiPage(project, page.id, {
        content: setChecklistStatus(page.content, {
          target: edit.id ? { id: edit.id } : { line: edit.bodyLine + bodyStartLine - 1 },
          payload: edit.payload,
          path: edit.path,
          field: edit.field,
          value: edit.value,
        }),
        expectedMtime: page.mtime,
        expectedHash: page.hash,
      }),
    onSuccess: (result) => {
      queryClient.setQueryData(detailKey, result.page)
      queryClient.invalidateQueries({ queryKey: queryKeys.wiki(project) })
    },
    onError: (error: Error) => {
      if (error instanceof ApiError && error.status === 409 && error.code === 'CONFLICT') {
        toast.error('The page changed on disk since it was loaded; the checkbox was not saved.', {
          duration: 15_000,
          action: {
            label: 'Reload',
            onClick: () => queryClient.invalidateQueries({ queryKey: detailKey }),
          },
        })
        return
      }
      toast.error(`checklist update failed: ${error.message}`)
    },
  })
  return useMemo(
    () => ({
      pending: mutation.isPending,
      readOnlyReason: isOwner ? null : 'read-only: sign in as the owner to change checklist state',
      toggle: (edit: ChecklistToggle) => {
        if (!isOwner || mutation.isPending) return
        mutation.mutate(edit)
      },
    }),
    [isOwner, mutation],
  )
}

function WikiDiagnosticsBlock({ diagnostics }: { diagnostics: readonly WikiDiagnostic[] }) {
  if (diagnostics.length === 0) return null
  const errors = diagnostics.filter((item) => item.severity === 'error')
  const warnings = diagnostics.filter((item) => item.severity !== 'error')
  return (
    <div className="mb-4 flex flex-col gap-1.5" data-wiki-diagnostics="">
      {[...errors, ...warnings].map((item, index) => (
        <div
          // Diagnostics have no identity beyond their position in the list.
          // biome-ignore lint/suspicious/noArrayIndexKey: display-only ordered list
          key={`${item.code}:${item.line ?? 'x'}:${index}`}
          data-severity={item.severity}
          className={cn(
            'flex flex-wrap items-baseline gap-2 rounded-md border p-2 text-xs',
            item.severity === 'error'
              ? 'border-destructive/50 bg-destructive/5 text-destructive'
              : 'border-ring bg-accent text-accent-foreground',
          )}
        >
          <span className="font-mono text-[10px] uppercase">{item.severity}</span>
          <span className="font-mono text-[10px]">{item.code}</span>
          {item.line !== undefined && (
            <span className="font-mono text-[10px] text-muted-foreground">line {item.line}</span>
          )}
          <span className="min-w-0 flex-1">{item.message}</span>
        </div>
      ))}
    </div>
  )
}

function WikiEditor({
  project,
  page,
  onClose,
}: {
  project: ProjectTarget
  page: WikiPageDetail
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [buffer, setBuffer] = useState(page.content)
  const [knownMtime, setKnownMtime] = useState(page.mtime)
  const [knownHash, setKnownHash] = useState(page.hash)
  const detailKey = useMemo(() => queryKeys.wikiPage(project, page.id), [project, page.id])

  // Lock inputs intentionally remain pinned to the snapshot that opened the
  // editor. An SSE refresh may update `page` while the user is typing; adopting
  // that newer mtime/hash here would let an old buffer overwrite the external
  // edit instead of producing the required conflict.

  const save = useMutation({
    mutationFn: () =>
      putWikiPage(project, page.id, {
        content: buffer,
        expectedMtime: knownMtime,
        expectedHash: knownHash,
      }),
    onSuccess: (result) => {
      setKnownMtime(result.page.mtime)
      setKnownHash(result.page.hash)
      queryClient.setQueryData(detailKey, result.page)
      queryClient.invalidateQueries({ queryKey: queryKeys.wiki(project) })
      queryClient.invalidateQueries({
        queryKey: queryKeys.wikiInventory(project),
      })
      toast.success('saved')
      onClose()
    },
    onError: (error: Error & { status?: number }) => {
      if (error.status === 409) {
        // Keep the buffer: the user decides when to drop their typing.
        toast.error('The file changed on disk since the editor opened.', {
          duration: 15_000,
          action: {
            label: 'Reload',
            onClick: async () => {
              try {
                const fresh = await fetchWikiPage(project, page.id)
                setBuffer(fresh.content)
                setKnownMtime(fresh.mtime)
                setKnownHash(fresh.hash)
                queryClient.setQueryData(detailKey, fresh)
                toast.success('reloaded latest file')
              } catch (cause) {
                const message = cause instanceof Error ? cause.message : String(cause)
                toast.error(`reload failed: ${message}`)
              }
            },
          },
        })
        return
      }
      toast.error(`save failed: ${error.message}`)
    },
  })

  return (
    <div className="flex h-full flex-col" data-wiki-editor="">
      <div className="flex items-center justify-between border-b px-3 py-2 text-xs">
        <span className="font-mono text-muted-foreground">edit · {page.id}</span>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => save.mutate()}
            disabled={save.isPending || buffer === page.content}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
      <div className="flex-1">
        <ReadmeMonaco value={buffer} onChange={setBuffer} />
      </div>
    </div>
  )
}

export { WikiDeprecatedBadge, WikiKindBadge, WikiStaleIndicator, WikiStatusBadge }
