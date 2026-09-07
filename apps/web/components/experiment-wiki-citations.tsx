'use client'

// "Cited by wiki" panel for the experiment-doc detail page. Fed by the
// detail response's `citedBy` projection (the inverted `sources` index), so it
// stays live through the same invalidation the rest of the page uses.
// Activating an entry opens the page in the shared right-side slot instead of
// navigating away from the Experiment.

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import type { WikiBacklink } from '@memon/core'
import { useWikiPane } from './terminal-drawer-provider'
import { setWikiWorkspaceUrl } from '../lib/wiki-workspace-url'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import {
  WikiDeprecatedBadge,
  WikiKindBadge,
  WikiReviewBadge,
  WikiStaleIndicator,
  WikiStatusBadge,
} from './wiki-page-card'

export function ExperimentWikiCitations({ citedBy }: { citedBy: readonly WikiBacklink[] }) {
  const { openWiki } = useWikiPane()
  const pathname = usePathname() ?? '/'
  const search = useSearchParams()?.toString() ?? ''
  const currentHref = `${pathname}${search ? `?${search}` : ''}`
  if (citedBy.length === 0) return null

  return (
    <Card data-slot="experiment-wiki-citations">
      <CardHeader>
        <CardTitle>
          Cited by wiki{' '}
          <span className="text-sm font-normal text-muted-foreground">({citedBy.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {citedBy.map((page) => (
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
            <span className="min-w-0 flex-1 truncate text-foreground">{page.title || page.slug}</span>
            <WikiKindBadge kind={page.kind} />
            <WikiStatusBadge status={page.status} />
            <WikiStaleIndicator stale={page.stale} staleSources={[]} />
            <WikiReviewBadge state={page.reviewState} />
            <WikiDeprecatedBadge deprecated={page.deprecated} />
          </Link>
        ))}
      </CardContent>
    </Card>
  )
}
