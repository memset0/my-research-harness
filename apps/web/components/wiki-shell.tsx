'use client'
import { translationSources } from '../lib/translation/sources'
import { BodyTranslation } from './body-translation'

// Per-project wiki surface.
//
// Desktop: rail (flat card list, newest edit first) | reading surface |
// sticky outline column. Activating Edit swaps the outline column for Monaco.
// Mobile: reading surface only, with a FAB that opens the same card list in a
// right-side Sheet and a full-viewport bottom Sheet for editing.

import type { WikiDiagnostic } from '@memon/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, History, List, PanelLeftClose, PanelLeftOpen, Pencil, X } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  ApiError,
  fetchWiki,
  fetchWikiPage,
  type ProjectTarget,
  projectHost,
  projectName,
  projectQueryKey,
  projectWebPath,
  putWikiPage,
  type WikiListItem,
  type WikiPageDetail,
} from '../lib/api'
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
import {
  handleFragmentClick,
  resetDriftedAncestors,
  scrollFragmentIntoSurface,
} from '../lib/scroll-to-fragment'
import { useUserPreferenceState } from '../lib/use-user-preference-state'
import { cn } from '../lib/utils'
import { wikiKinds } from '../lib/wiki-kinds'
import { DocumentArtifactLinkProvider } from './document-artifact-link-provider'
import { FrontmatterPanel } from './frontmatter-panel'
import { Markdown } from './markdown'
import { ReadmeMonaco } from './readme-monaco'
import { ReportHtmlZoomProvider } from './report-html-embed'
import { useIsOwner } from './session-provider'
import { ListSkeleton } from './skeletons'
import { TimestampLocal } from './timestamp'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from './ui/sheet'
import { WikiKindHelp } from './wiki-kind-help'
import {
  filterWikiPages,
  sortWikiPages,
  WIKI_KIND_ORDER,
  WikiDeprecatedBadge,
  WikiKindBadge,
  WikiPageCard,
  WikiReviewBadge,
  WikiStaleIndicator,
  WikiStatusBadge,
} from './wiki-page-card'
import { WikiChangesDialog, WikiReviewPanel } from './wiki-review-panel'

const WIKI_RAIL_PREFERENCE_KEY = 'memon:wiki:rail-open'
const WIKI_TIMESTAMP_KEYS = ['created_at', 'updated_at', 'date'] as const

const EMPTY_BODY =
  'No wiki pages yet. Pages are written by the `memon-wiki` skill, or from the shell with `memon wiki create <kind> <slug> --title "…"`.'

/** Asset endpoint for a bundle-form page, mirroring `reportResourceBaseUrl`. */
export function wikiResourceBaseUrl(project: ProjectTarget, wikiId: string): string {
  const base = `/api/wiki-assets/${encodeURIComponent(projectName(project))}/${encodeURIComponent(wikiId)}`
  const host = projectHost(project)
  return host
    ? `${base}?host=${encodeURIComponent(host)}&project=${encodeURIComponent(projectName(project))}`
    : base
}

export function useWikiPages(project: ProjectTarget) {
  const query = useQuery({
    queryKey: ['wiki', ...projectQueryKey(project)],
    queryFn: () => fetchWiki(project),
    staleTime: 5_000,
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
  const { pages, isLoading, error, refetch } = useWikiPages(project)
  const [storedRailOpen, setRailOpen] = useUserPreferenceState<boolean>(
    WIKI_RAIL_PREFERENCE_KEY,
    true,
  )
  const railOpen = typeof storedRailOpen === 'boolean' ? storedRailOpen : true
  const [kindFilter, setKindFilter] = useState('all')
  const [textFilter, setTextFilter] = useState('')
  const visible = useMemo(
    () => filterWikiPages(pages, { kind: kindFilter, text: textFilter }),
    [pages, kindFilter, textFilter],
  )

  const detail = useQuery({
    queryKey: ['wiki-page', ...projectQueryKey(project), selectedId],
    queryFn: () => fetchWikiPage(project, selectedId!),
    enabled: selectedId !== null,
  })

  const filters = (
    <WikiRailFilters
      kind={kindFilter}
      text={textFilter}
      kinds={pages}
      onKindChange={setKindFilter}
      onTextChange={setTextFilter}
    />
  )

  return (
    <div className="flex h-[calc(100svh-3rem)] overflow-hidden">
      {railOpen && (
        <aside
          aria-label="Wiki page picker"
          className="hidden w-80 shrink-0 flex-col border-r md:flex"
          data-wiki-rail=""
        >
          <div className="flex items-center justify-between border-b px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
            <span>Wiki</span>
            <div className="flex items-center gap-1.5">
              <span className="tabular-nums">{visible.length}</span>
              <WikiRailToggleButton action="hide" onClick={() => setRailOpen(false)} />
            </div>
          </div>
          <div className="border-b p-2">{filters}</div>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            <WikiCardList
              project={project}
              pages={visible}
              selectedId={selectedId}
              loading={isLoading}
              error={error}
              onRetry={refetch}
              filtered={textFilter.trim() !== '' || kindFilter !== 'all'}
            />
          </div>
        </aside>
      )}

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {selectedId === null ? (
          <WikiLandingState
            pageCount={pages.length}
            isLoading={isLoading}
            error={error}
            onShowRail={railOpen ? undefined : () => setRailOpen(true)}
          />
        ) : (
          <WikiSelectedPane
            project={project}
            selectedId={selectedId}
            page={detail.data}
            isLoading={detail.isLoading}
            error={(detail.error as Error | null) ?? null}
            pages={pages}
            pagesLoading={isLoading}
            onShowRail={railOpen ? undefined : () => setRailOpen(true)}
          />
        )}
      </main>

      <WikiMobileRail
        project={project}
        pages={visible}
        selectedId={selectedId}
        loading={isLoading}
        error={error}
        onRetry={refetch}
        filters={filters}
        filtered={textFilter.trim() !== '' || kindFilter !== 'all'}
      />
    </div>
  )
}

function WikiRailToggleButton({
  action,
  onClick,
}: {
  action: 'show' | 'hide'
  onClick: () => void
}) {
  const label = action === 'show' ? 'Show wiki pages' : 'Hide wiki pages'
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
    <div className="flex flex-col gap-2">
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
}: {
  project: ProjectTarget
  pages: readonly WikiListItem[]
  selectedId: string | null
  loading: boolean
  error?: Error | null
  onRetry?: () => void
  filtered: boolean
  onSelect?: () => void
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
    <ul className="flex flex-col gap-1.5 p-2">
      {pages.map((page) => (
        <li key={page.id}>
          <WikiPageCard
            page={page}
            href={projectWebPath(project, `/wiki/${encodeURIComponent(page.id)}`)}
            active={page.id === selectedId}
            onSelect={onSelect}
          />
        </li>
      ))}
    </ul>
  )
}

function ClosedRailToolbar({ onShowRail }: { onShowRail: () => void }) {
  return (
    <div className="hidden shrink-0 items-center border-b px-3 py-2 md:flex">
      <WikiRailToggleButton action="show" onClick={onShowRail} />
    </div>
  )
}

function WikiLandingState({
  pageCount,
  isLoading,
  error,
  onShowRail,
}: {
  pageCount: number
  isLoading: boolean
  error: Error | null
  onShowRail?: () => void
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-end gap-2 border-b px-4 py-2">
        {onShowRail && <WikiRailToggleButton action="show" onClick={onShowRail} />}
        <WikiKindHelp />
      </div>
      <div className="flex flex-1 items-center justify-center p-8">
        {isLoading ? (
          <div className="w-full max-w-md">
            <ListSkeleton count={3} />
          </div>
        ) : error ? (
          <p className="max-w-md text-sm text-destructive">
            Failed to load wiki pages: {error.message}
          </p>
        ) : pageCount > 0 ? (
          <p className="max-w-md text-sm text-muted-foreground" data-wiki-no-selection="">
            Select a wiki page from the page list to begin reading.
          </p>
        ) : (
          <div className="max-w-md text-sm text-muted-foreground" data-wiki-empty-state="">
            <Markdown>{EMPTY_BODY}</Markdown>
          </div>
        )}
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
  pages,
  pagesLoading,
  onShowRail,
}: {
  project: ProjectTarget
  selectedId: string
  page: WikiPageDetail | undefined
  isLoading: boolean
  error: Error | null
  pages: readonly WikiListItem[]
  pagesLoading: boolean
  onShowRail?: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [widthLimited, setWidthLimited] = useState(true)
  const isOwner = useIsOwner()
  const notFound = (error as (Error & { status?: number }) | null)?.status === 404

  if (isLoading && !page) {
    return (
      <div className="flex h-full flex-col">
        {onShowRail && <ClosedRailToolbar onShowRail={onShowRail} />}
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
        {onShowRail && <ClosedRailToolbar onShowRail={onShowRail} />}
        <div className="p-4 text-sm" data-wiki-not-found="">
          {error && !notFound ? (
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
  const showHistory = isOwner && page.review !== null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b bg-background/95 px-4 py-2 backdrop-blur">
        <div className="flex min-w-0 items-center gap-2">
          {onShowRail && <WikiRailToggleButton action="show" onClick={onShowRail} />}
          <div className="flex min-w-0 items-baseline gap-2 text-xs">
            <WikiIdentity
              key={onShowRail ? 'collapsed' : 'expanded'}
              project={project}
              page={page}
              pages={pages}
              pagesLoading={pagesLoading}
              quickSwitchEnabled={onShowRail !== undefined}
            />
            <span className="text-muted-foreground/60">·</span>
            <TimestampLocal value={page.updatedAt} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
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
          {showHistory && (
            <Button size="sm" variant="outline" onClick={() => setHistoryOpen(true)}>
              <History className="size-3.5" />
              History
            </Button>
          )}
          <Button
            size="sm"
            variant={editing ? 'secondary' : 'outline'}
            onClick={() => setEditing((value) => !value)}
          >
            {editing ? <X className="size-3.5" /> : <Pencil className="size-3.5" />}
            {editing ? 'Cancel' : 'Edit'}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden"
          data-wiki-reading-surface=""
        >
          <div className="flex justify-center gap-6 p-4 md:p-6" data-wiki-reading-layout="">
            <div
              className={cn('min-w-0 flex-1 bg-card p-4 md:p-6', widthLimited && 'max-w-[800px]')}
              data-wiki-document-column=""
            >
              <WikiDocumentView
                project={project}
                page={page}
                sourceSurface="full-wiki"
                widthLimited={widthLimited}
              />
              <WikiFragmentDeepLink pageId={page.id} />
            </div>
            {!editing && outline.length > 0 && (
              <nav
                aria-label="Table of contents"
                className="sticky top-6 hidden max-h-[calc(100svh-12rem)] w-60 shrink-0 self-start overflow-y-auto overflow-x-hidden border-l p-3 md:block"
                data-wiki-outline=""
              >
                <p className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                  On this page
                </p>
                <WikiOutlineList entries={outline} />
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

      {showHistory && (
        <WikiReviewPanel project={project} open={historyOpen} onOpenChange={setHistoryOpen} />
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

function WikiIdentity({
  project,
  page,
  pages,
  pagesLoading,
  quickSwitchEnabled,
}: {
  project: ProjectTarget
  page: WikiPageDetail
  pages: readonly WikiListItem[]
  pagesLoading: boolean
  quickSwitchEnabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const identity = `${page.id} ${page.slug}`

  if (!quickSwitchEnabled) {
    return (
      <>
        <span className="font-mono tabular-nums">{page.id}</span>
        <span className="truncate text-muted-foreground">{page.slug}</span>
      </>
    )
  }

  return (
    <>
      <span className="flex min-w-0 items-baseline gap-2 md:hidden" data-wiki-identity-mobile>
        <span className="font-mono tabular-nums">{page.id}</span>
        <span className="truncate text-muted-foreground">{page.slug}</span>
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="hidden h-6 min-w-0 max-w-[min(28rem,45vw)] gap-1.5 px-1.5 md:inline-flex"
            aria-label={`Switch wiki page, current ${identity}`}
            title={identity}
          >
            <span className="shrink-0 font-mono tabular-nums">{page.id}</span>
            <span className="min-w-0 truncate text-muted-foreground">{page.slug}</span>
            <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 gap-0 p-0" aria-label="Switch wiki page">
          <div className="flex items-center justify-between border-b px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
            <span>Wiki</span>
            <span className="tabular-nums">{pages.length}</span>
          </div>
          <div className="max-h-[min(24rem,60vh)] overflow-y-auto" data-wiki-quick-switch-list>
            <WikiCardList
              project={project}
              pages={pages}
              selectedId={page.id}
              loading={pagesLoading}
              filtered={false}
              onSelect={() => setOpen(false)}
            />
          </div>
        </PopoverContent>
      </Popover>
    </>
  )
}

export function WikiDocumentView({
  project,
  page,
  sourceSurface,
  widthLimited = true,
}: {
  project: ProjectTarget
  page: WikiPageDetail
  sourceSurface: 'full-wiki' | 'side-wiki'
  widthLimited?: boolean
}) {
  const { frontmatter, body } = useMemo(() => splitFrontmatter(page.content), [page.content])
  // `unverifiedRanges` and checklist edits are file lines; the body starts
  // after the frontmatter block, so tell both where its line 1 lands.
  const bodyStartLine = useMemo(
    () => page.content.slice(0, page.content.length - body.length).split('\n').length,
    [body, page.content],
  )
  const unverified = useMemo(() => {
    if (!page.review || page.review.state !== 'CHANGED_SINCE_VERIFY') return undefined
    return {
      ranges: page.review.unverifiedRanges,
      lineOffset: bodyStartLine,
      title: page.review.dirty
        ? 'changed since verification (uncommitted)'
        : `changed since verification (${page.review.unverifiedCommits.map((sha) => sha.slice(0, 8)).join(', ') || 'later commits'})`,
    }
  }, [bodyStartLine, page.review])
  const wholeBodyUnverified = page.review?.state === 'UNVERIFIED'
  const checklistWrite = useWikiChecklistWrite(project, page, bodyStartLine)
  const componentDocumentPath = page.resource ?? page.path
  const componentDocument = componentDocumentPath
    ? {
        project: projectName(project),
        host: projectHost(project) ?? undefined,
        path: componentDocumentPath,
      }
    : undefined

  return (
    <DocumentArtifactLinkProvider
      project={project}
      sourceDocumentPath={page.resource ?? page.path}
      sourceSurface={sourceSurface}
    >
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
                href={projectWebPath(
                  project,
                  `/wiki/${encodeURIComponent(page.deprecated.superseded_by)}`,
                )}
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

      <WikiReviewSummary project={project} page={page} />
      <WikiDiagnosticsBlock diagnostics={page.diagnostics} />

      <div
        className={cn('mx-auto w-full', widthLimited && 'max-w-[800px]')}
        data-wiki-document-body=""
        lang={page.language === 'zh' ? 'zh-CN' : 'en'}
        title={wholeBodyUnverified ? 'no line of this page is verified' : undefined}
        data-wiki-unverified-body={wholeBodyUnverified ? '' : undefined}
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
                unverified={unverified}
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
  const detailKey = useMemo(
    () => ['wiki-page', ...projectQueryKey(project), page.id],
    [project, page.id],
  )
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
      queryClient.invalidateQueries({ queryKey: ['wiki', ...projectQueryKey(project)] })
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

function WikiReviewSummary({ project, page }: { project: ProjectTarget; page: WikiPageDetail }) {
  const [open, setOpen] = useState(false)
  if (!page.review) return null
  const { review } = page
  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-2 text-xs"
      data-wiki-review-summary=""
      data-review-state={review.state}
    >
      <WikiReviewBadge state={review.state} verifiedAt={review.verifiedAt} />
      <span className="text-muted-foreground">verified through</span>
      <span className="font-mono">
        {review.verifiedThrough ? review.verifiedThrough.slice(0, 8) : '—'}
      </span>
      {review.state !== 'VERIFIED' && review.verifiedThrough && (
        <>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            onClick={() => setOpen(true)}
          >
            changes since verification
          </Button>
          <WikiChangesDialog
            project={project}
            pageId={page.id}
            pagePath={page.path ?? page.resource ?? ''}
            review={review}
            open={open}
            onOpenChange={setOpen}
          />
        </>
      )}
      {review.dirty && <span className="text-muted-foreground">(uncommitted edits)</span>}
    </div>
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
  const detailKey = useMemo(
    () => ['wiki-page', ...projectQueryKey(project), page.id],
    [project, page.id],
  )

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
      queryClient.invalidateQueries({ queryKey: ['wiki', ...projectQueryKey(project)] })
      queryClient.invalidateQueries({
        queryKey: ['wiki-inventory', ...projectQueryKey(project)],
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

function WikiMobileRail({
  project,
  pages,
  selectedId,
  loading,
  error,
  onRetry,
  filters,
  filtered,
}: {
  project: ProjectTarget
  pages: readonly WikiListItem[]
  selectedId: string | null
  loading: boolean
  error?: Error | null
  onRetry?: () => void
  filters: React.ReactNode
  filtered: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          size="icon"
          className="fixed right-6 bottom-6 z-30 size-12 rounded-full shadow-lg md:hidden"
          aria-label="Open wiki page list"
        >
          <List className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-80 overflow-y-auto p-0">
        <SheetHeader className="border-b px-3 py-3">
          <SheetTitle className="text-sm">
            Wiki · {projectHost(project) ? `${projectHost(project)}/` : ''}
            {projectName(project)}
          </SheetTitle>
        </SheetHeader>
        <div className="border-b p-2">{filters}</div>
        <WikiCardList
          project={project}
          pages={pages}
          selectedId={selectedId}
          loading={loading}
          error={error}
          onRetry={onRetry}
          filtered={filtered}
          onSelect={() => setOpen(false)}
        />
      </SheetContent>
    </Sheet>
  )
}

export { WikiDeprecatedBadge, WikiKindBadge, WikiReviewBadge, WikiStaleIndicator, WikiStatusBadge }
