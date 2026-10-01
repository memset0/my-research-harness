'use client'

import type { BackendResourceInventoryResponse, BackendWikiInventoryResponse } from '@memon/core'
import { useQuery } from '@tanstack/react-query'
import {
  fetchCodeReviewsInventory,
  fetchExperimentsInventory,
  fetchHypotheses,
  fetchJournalCount,
  fetchReportsInventory,
  fetchWikiInventory,
  type HypothesesResponse,
  type JournalCountResponse,
  type ProjectTarget,
  projectQueryKey,
} from '../lib/api'
import { queryKeys } from '../lib/query-keys'
import { cn } from '../lib/utils'

export type TabKind = 'experiments' | 'hypotheses' | 'journal' | 'reports' | 'code-review' | 'wiki'

/**
 * Small count badge rendered next to AppBar tab labels. File-backed
 * collections use identity-only inventories; Hypotheses still needs its
 * content projection and Journal keeps its count-only endpoint.
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
  const q = useQuery({
    queryKey: queryKeys.tabCollection(kind, project),
    queryFn: () => fetchTabCollection(kind, project),
    select: countTabCollection,
    staleTime: 5_000,
  })
  return { value: q.data, isLoading: q.isLoading }
}

type TabCollection =
  | BackendResourceInventoryResponse
  | BackendWikiInventoryResponse
  | HypothesesResponse
  | JournalCountResponse

function fetchTabCollection(kind: TabKind, project: ProjectTarget): Promise<TabCollection> {
  switch (kind) {
    case 'experiments':
      return fetchExperimentsInventory(project)
    case 'hypotheses':
      return fetchHypotheses(project)
    case 'journal':
      return fetchJournalCount(project)
    case 'reports':
      return fetchReportsInventory(project)
    case 'code-review':
      return fetchCodeReviewsInventory(project)
    case 'wiki':
      return fetchWikiInventory(project)
  }
}

function countTabCollection(data: TabCollection): number {
  if ('items' in data) return data.items.length
  if ('entries' in data) return data.entries.length
  if ('totalEvents' in data) return data.totalEvents
  if ('pages' in data) return data.pages.length
  return 0
}
