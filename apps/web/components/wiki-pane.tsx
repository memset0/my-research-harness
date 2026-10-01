'use client'

// Side wiki surface for the paired-document workspace. Mirrors <ReportPane>:
// same header controls, same quick-switcher shape, same single right slot.

import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, ChevronDown, PanelRight, PanelRightClose, Rows3, X } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import {
  fetchWikiPage,
  type ProjectTarget,
  projectQueryKey,
  projectWebPath,
  type WikiListItem,
} from '../lib/api'
import { queryKeys } from '../lib/query-keys'
import { cn } from '../lib/utils'
import { switchWikiWorkspaceUrl } from '../lib/wiki-workspace-url'
import { ListSkeleton } from './skeletons'
import { Button } from './ui/button'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import {
  WikiKindBadge,
  WikiReviewBadge,
  WikiStaleIndicator,
  WikiStatusBadge,
} from './wiki-page-card'
import { useWikiPages, WikiDocumentView } from './wiki-shell'

export type WikiPaneSurface = 'drawer' | 'split'

export function WikiPane({
  project,
  wikiId,
  surface,
  onSwitch,
  onSurfaceChange,
  onClose,
}: {
  project: ProjectTarget
  wikiId: string
  surface: WikiPaneSurface
  onSwitch: (wikiId: string) => void
  onSurfaceChange: (surface: WikiPaneSurface) => void
  onClose: () => void
}) {
  const list = useWikiPages(project)
  const detail = useQuery({
    queryKey: queryKeys.wikiPage(project, wikiId),
    queryFn: () => fetchWikiPage(project, wikiId),
  })
  const selectedSummary = list.pages.find((page) => page.id === wikiId)
  const slug = detail.data?.slug ?? selectedSummary?.slug ?? ''
  const identity = slug ? `${wikiId} ${slug}` : wikiId

  return (
    <section
      className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-card text-card-foreground"
      data-wiki-pane=""
      data-surface={surface}
      aria-label={`Wiki page ${wikiId}`}
    >
      <header className="flex min-h-11 shrink-0 items-center justify-between gap-2 border-b bg-card px-2.5 py-1.5">
        <WikiPaneSwitcher
          wikiId={wikiId}
          identity={identity}
          pages={list.pages}
          loading={list.isLoading}
          error={list.error}
          onRetry={list.refetch}
          onSwitch={onSwitch}
        />
        <div className="flex shrink-0 items-center gap-0.5">
          {surface === 'split' ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Move wiki page to drawer"
              title="Move to drawer"
              onClick={() => onSurfaceChange('drawer')}
            >
              <PanelRight className="size-3.5" />
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="hidden md:inline-flex"
              aria-label="Split wiki page right"
              title="Split right"
              onClick={() => onSurfaceChange('split')}
            >
              <Rows3 className="size-3.5 -rotate-90" />
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" asChild title="Open full wiki page">
            <Link
              href={projectWebPath(project, `/wiki/${encodeURIComponent(wikiId)}`)}
              aria-label="Open full wiki page"
            >
              <ArrowUpRight className="size-3.5" />
            </Link>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close wiki page"
            title="Close wiki page"
            onClick={onClose}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-card">
        {detail.isLoading && !detail.data ? (
          <div className="p-4">
            <ListSkeleton count={4} />
          </div>
        ) : detail.error && !detail.data ? (
          <WikiPaneError wikiId={wikiId} message={(detail.error as Error).message} />
        ) : !detail.data ? (
          <WikiPaneError wikiId={wikiId} message="Wiki page not found" />
        ) : (
          <div className="p-4 md:p-5">
            <WikiDocumentView project={project} page={detail.data} sourceSurface="side-wiki" />
          </div>
        )}
      </div>
    </section>
  )
}

function WikiPaneSwitcher({
  wikiId,
  identity,
  pages,
  loading,
  error,
  onRetry,
  onSwitch,
}: {
  wikiId: string
  identity: string
  pages: readonly WikiListItem[]
  loading: boolean
  error?: Error | null
  onRetry?: () => void
  onSwitch: (wikiId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname() ?? '/'
  const search = useSearchParams()?.toString() ?? ''
  const currentHref = `${pathname}${search ? `?${search}` : ''}`
  const active = pages.find((page) => page.id === wikiId)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 min-w-0 max-w-full justify-start gap-1.5 px-1.5"
          aria-label={`Switch wiki page, current ${identity}`}
          title={identity}
        >
          <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-primary">
            {wikiId}
          </span>
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {active?.slug ?? identity.replace(`${wikiId} `, '')}
          </span>
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 max-w-[calc(100vw-2rem)] gap-0 p-0"
        aria-label="Switch wiki page"
      >
        <div className="flex items-center justify-between border-b px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
          <span>Wiki</span>
          <span className="tabular-nums">{pages.length}</span>
        </div>
        <div className="max-h-[min(28rem,65vh)] overflow-y-auto p-2" data-wiki-pane-switch-list>
          {loading && pages.length === 0 ? (
            <ListSkeleton count={4} />
          ) : error && pages.length === 0 ? (
            <div
              className="flex flex-col items-center gap-2 px-3 py-5 text-center"
              data-wiki-switch-error=""
            >
              <p className="text-xs font-medium text-destructive">failed to load wiki pages</p>
              <p className="break-words text-[10px] text-muted-foreground">{error.message}</p>
              {onRetry && (
                <Button type="button" size="sm" variant="outline" onClick={() => onRetry()}>
                  Retry
                </Button>
              )}
            </div>
          ) : pages.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">no wiki pages yet</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {pages.map((page) => {
                const selected = page.id === wikiId
                return (
                  <li key={page.id}>
                    <Link
                      href={switchWikiWorkspaceUrl(currentHref, page.id)}
                      aria-current={selected ? 'page' : undefined}
                      className={cn(
                        'block w-full rounded-md border border-border bg-card p-2.5 text-left text-xs transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        selected && 'border-primary bg-primary/5',
                      )}
                      onClick={(event) => {
                        setOpen(false)
                        if (
                          selected ||
                          event.button !== 0 ||
                          event.metaKey ||
                          event.ctrlKey ||
                          event.shiftKey ||
                          event.altKey
                        ) {
                          return
                        }
                        event.preventDefault()
                        onSwitch(page.id)
                      }}
                    >
                      <span className="flex flex-wrap items-center gap-1">
                        <WikiKindBadge kind={page.kind} />
                        <WikiStatusBadge status={page.status} />
                        <WikiStaleIndicator stale={page.stale} staleSources={page.staleSources} />
                        <WikiReviewBadge state={page.review?.state} />
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5">
                        <span className="font-mono text-[10px] font-semibold tabular-nums text-primary">
                          {page.id}
                        </span>
                        <span className="min-w-0 truncate text-[11px]">
                          {page.title || (
                            <span className="italic text-muted-foreground/60">(no title)</span>
                          )}
                        </span>
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function WikiPaneError({ wikiId, message }: { wikiId: string; message: string }) {
  return (
    <div className="flex h-full min-h-48 items-center justify-center p-6 text-center">
      <div className="space-y-2">
        <PanelRightClose className="mx-auto size-8 text-muted-foreground/60" />
        <p className="font-mono text-sm font-medium">{wikiId}</p>
        <p className="max-w-xs text-xs text-muted-foreground">{message}</p>
      </div>
    </div>
  )
}
