'use client'

import { useQuery } from '@tanstack/react-query'
import {
  type CodeReviewsResponse,
  type DigestsResponse,
  type ExperimentDocsResponse,
  fetchCodeReviews,
  fetchDigests,
  fetchExperimentDocs,
  fetchHypotheses,
  fetchJournalCount,
  fetchReports,
  fetchWiki,
  type HypothesesResponse,
  type JournalCountResponse,
  type ProjectTarget,
  projectQueryKey,
  type ReportsResponse,
  type WikiPagesResponse,
} from '../lib/api'
import { cn } from '../lib/utils'

export type TabKind =
  | 'experiments'
  | 'hypotheses'
  | 'journal'
  | 'reports'
  | 'digests'
  | 'code-review'
  | 'wiki'

/**
 * Small count badge rendered next to AppBar tab labels. Reuses the same
 * React Query keys as the underlying views (experiments / hypotheses) so the
 * AppBar observes the same cache the views write to. Journal uses a
 * dedicated `?countOnly=1` shortcut so its count reflects the project total
 * regardless of any default page-limit applied by the journal view.
 *
 * Loading: renders a skeleton pulse (avoids a flash of "0").
 * Resolved: renders the count in tabular-nums.
 *
 * Adjacent `<span data-slot="warnings">` is a reserved hook for the future
 * warnings-system change. Empty today; a later change can fill it without
 * relayout.
 *
 * Returns a Fragment — both spans become direct flex children of the parent
 * Link (which inherits Button's `inline-flex items-center` layout). Wrapping
 * them in another `inline-flex` here would create a nested flex context whose
 * baseline drifts from the label's, breaking vertical alignment.
 */
export function TabBadge({
  kind,
  project,
  active = false,
}: {
  kind: TabKind
  project: ProjectTarget
  active?: boolean
}) {
  const count = useTabCount(kind, project)

  return (
    <>
      {count.isLoading && count.value === undefined ? (
        <span
          className="inline-block h-3 w-4 animate-pulse rounded bg-muted/60"
          data-slot="count"
          aria-hidden="true"
        />
      ) : (
        <span
          data-slot="count"
          className={cn(
            'text-[10px] leading-none tabular-nums',
            active ? 'text-primary-foreground/75' : 'text-muted-foreground',
          )}
        >
          {count.value ?? 0}
        </span>
      )}
      {/* Reserved for a future warnings-system change. Intentionally empty. */}
      <span data-slot="warnings" />
    </>
  )
}

interface TabCountResult {
  value: number | undefined
  isLoading: boolean
}

function useTabCount(kind: TabKind, project: ProjectTarget): TabCountResult {
  // Every tab key except journal's is SHARED with the view that renders the
  // corresponding list (InboxShell, HypothesisView, ReportPane, the SSR
  // prefetches in app/p/[project]/*). A shared key is one cache entry, so
  // this observer MUST cache the list's own DTO and project it to a number
  // in `select`. Caching a bare count here races the list observer: whichever
  // queryFn resolves first wins the entry, and when the badge wins, the list
  // reads `data.reports` off a number, gets undefined, and silently renders
  // its empty state on a perfectly healthy 200 response.
  const cacheKind = kind === 'journal' ? 'journal-count' : kind
  const q = useQuery({
    queryKey: [cacheKind, ...projectQueryKey(project)],
    queryFn: () => fetchTabCollection(kind, project),
    select: countTabCollection,
    staleTime: 5_000,
  })
  return { value: q.data, isLoading: q.isLoading }
}

type TabCollection =
  | ExperimentDocsResponse
  | HypothesesResponse
  | JournalCountResponse
  | ReportsResponse
  | DigestsResponse
  | CodeReviewsResponse
  | WikiPagesResponse

function fetchTabCollection(kind: TabKind, project: ProjectTarget): Promise<TabCollection> {
  switch (kind) {
    case 'experiments':
      return fetchExperimentDocs(project)
    case 'hypotheses':
      return fetchHypotheses(project)
    case 'journal':
      // Dedicated `journal-count` key + `?countOnly=1` endpoint: the count
      // must ignore the journal view's page limit, so it cannot share the
      // view's cache entry.
      return fetchJournalCount(project)
    case 'reports':
      return fetchReports(project)
    case 'digests':
      return fetchDigests(project)
    case 'code-review':
      return fetchCodeReviews(project)
    case 'wiki':
      return fetchWiki(project)
  }
}

/**
 * Structural narrowing rather than a `kind` switch: the DTO decides the count,
 * so a future tab that reuses an existing collection shape needs no change
 * here, and there is no way for the two switches to drift apart.
 */
function countTabCollection(data: TabCollection): number {
  if ('experiments' in data) return data.experiments.length
  if ('entries' in data) return data.entries.length
  if ('totalEvents' in data) return data.totalEvents
  if ('reports' in data) return data.reports.length
  if ('digests' in data) return data.digests.length
  if ('codeReviews' in data) return data.codeReviews.length
  if ('pages' in data) return data.pages.length
  return 0
}
