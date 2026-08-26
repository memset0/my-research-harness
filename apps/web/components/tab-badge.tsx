'use client'

import { useQuery } from '@tanstack/react-query'
import {
  fetchCodeReviews,
  fetchDigests,
  fetchExperimentDocs,
  fetchHypotheses,
  fetchJournalCount,
  fetchReports,
  type ProjectTarget,
  projectQueryKey,
} from '../lib/api'
import { cn } from '../lib/utils'

export type TabKind =
  | 'experiments'
  | 'hypotheses'
  | 'journal'
  | 'reports'
  | 'digests'
  | 'code-review'

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
  const cacheKind = kind === 'journal' ? 'journal-count' : kind
  const q = useQuery({
    queryKey: [cacheKind, ...projectQueryKey(project)],
    queryFn: async () => {
      switch (kind) {
        case 'experiments':
          return (await fetchExperimentDocs(project)).experiments.length
        case 'hypotheses':
          return (await fetchHypotheses(project)).entries.length
        case 'journal':
          return (await fetchJournalCount(project)).totalEvents
        case 'reports':
          return (await fetchReports(project)).reports.length
        case 'digests':
          return (await fetchDigests(project)).digests.length
        case 'code-review':
          return (await fetchCodeReviews(project)).codeReviews.length
      }
    },
    staleTime: 5_000,
  })
  return { value: q.data, isLoading: q.isLoading }
}
