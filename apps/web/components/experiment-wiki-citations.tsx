'use client'

// Wiki source resolution may read Run evidence. It starts only when the reader
// opens this panel, and follows the shared heartbeat only while open.
// Activating an entry opens the page in the shared right-side slot instead of
// navigating away from the Experiment.

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { fetchWikiBacklinks, type ProjectTarget, projectQueryKey } from '../lib/api'
import { setWikiWorkspaceUrl } from '../lib/wiki-workspace-url'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'
import {
  WikiDeprecatedBadge,
  WikiKindBadge,
  WikiReviewBadge,
  WikiStaleIndicator,
  WikiStatusBadge,
} from './wiki-page-card'
import { useWikiPane } from './workspace-pane-provider'

export function ExperimentWikiCitations({
  project,
  experimentId,
}: {
  project: ProjectTarget
  experimentId: string
}) {
  const [open, setOpen] = useState(false)
  const { data, error } = useQuery({
    queryKey: ['wiki-backlinks', ...projectQueryKey(project), experimentId],
    queryFn: () => fetchWikiBacklinks(project, experimentId),
    enabled: open,
  })
  const { openWiki } = useWikiPane()
  const pathname = usePathname() ?? '/'
  const search = useSearchParams()?.toString() ?? ''
  const currentHref = `${pathname}${search ? `?${search}` : ''}`
  const citedBy = data?.pages ?? []

  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <Card data-slot="experiment-wiki-citations">
        <CardHeader>
          <CardTitle>
            <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-2 text-left">
              Cited by wiki
              {data && (
                <span className="text-sm font-normal text-muted-foreground">
                  ({citedBy.length})
                </span>
              )}
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                {open ? 'Hide' : 'Show'}
              </span>
            </CollapsibleTrigger>
          </CardTitle>
        </CardHeader>
        <CollapsibleContent>
          {open && (
            <CardContent className="flex flex-col gap-2">
              {!data ? (
                <div className="text-sm text-muted-foreground" role="status">
                  {error ? 'Could not load wiki citations.' : 'Loading wiki citations…'}
                </div>
              ) : citedBy.length === 0 ? (
                <div className="text-sm text-muted-foreground">No wiki citations.</div>
              ) : (
                citedBy.map((page) => (
                  <Link
                    key={page.id}
                    href={setWikiWorkspaceUrl(currentHref, page.id)}
                    onClick={(event) => {
                      if (
                        event.button !== 0 ||
                        event.metaKey ||
                        event.ctrlKey ||
                        event.shiftKey ||
                        event.altKey
                      ) {
                        return
                      }
                      event.preventDefault()
                      openWiki(page.id)
                    }}
                    data-slot="experiment-wiki-citation-row"
                    data-wiki-id={page.id}
                    className="flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                      {page.id}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-foreground">
                      {page.title || page.slug}
                    </span>
                    <WikiKindBadge kind={page.kind} />
                    <WikiStatusBadge status={page.status} />
                    <WikiStaleIndicator stale={page.stale} staleSources={[]} />
                    <WikiReviewBadge state={page.reviewState} />
                    <WikiDeprecatedBadge deprecated={page.deprecated} />
                  </Link>
                ))
              )}
            </CardContent>
          )}
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}
