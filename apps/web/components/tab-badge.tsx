'use client'

import { useQuery } from '@tanstack/react-query'
import { fetchExperiments, fetchHypotheses, fetchJournalCount } from '../lib/api'
import { cn } from '../lib/utils'

export type TabKind = 'experiments' | 'hypotheses' | 'journal'

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
 */
export function TabBadge({
  kind,
  project,
  active = false,
}: {
  kind: TabKind
  project: string
  active?: boolean
}) {
  const count = useTabCount(kind, project)

  return (
    <span className="ml-1.5 inline-flex items-center gap-1">
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
            'text-[10px] tabular-nums',
            active ? 'text-primary-foreground/75' : 'text-muted-foreground',
          )}
        >
          {count.value ?? 0}
        </span>
      )}
      {/* Reserved for a future warnings-system change. Intentionally empty. */}
      <span data-slot="warnings" className="inline-flex" />
    </span>
  )
}

interface TabCountResult {
  value: number | undefined
  isLoading: boolean
}

function useTabCount(kind: TabKind, project: string): TabCountResult {
  switch (kind) {
    case 'experiments':
      return useExperimentsCount(project)
    case 'hypotheses':
      return useHypothesesCount(project)
    case 'journal':
      return useJournalCount(project)
  }
}

function useExperimentsCount(project: string): TabCountResult {
  const q = useQuery({
    queryKey: ['experiments', project],
    queryFn: () => fetchExperiments(project),
    staleTime: 5_000,
  })
  return { value: q.data?.experiments.length, isLoading: q.isLoading }
}

function useHypothesesCount(project: string): TabCountResult {
  const q = useQuery({
    queryKey: ['hypotheses', project],
    queryFn: () => fetchHypotheses(project),
    staleTime: 5_000,
  })
  return { value: q.data?.entries.length, isLoading: q.isLoading }
}

function useJournalCount(project: string): TabCountResult {
  const q = useQuery({
    queryKey: ['journal-count', project],
    queryFn: () => fetchJournalCount(project),
    staleTime: 5_000,
  })
  return { value: q.data?.totalEvents, isLoading: q.isLoading }
}
