'use client'

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { subscribeMemonEvents } from '../lib/events-client'
import type { IndexedRun } from '../lib/api'

/**
 * Subscribes to /api/events SSE and invalidates the relevant TanStack Query
 * caches when v3 events arrive. Toasts when a previously unknown run or
 * exp doc shows up.
 *
 * Topic → invalidations (v3, post v3-spec-sync):
 *   - run-change         → ['runs'], ['run', id], ['experiment', parentExperimentId]
 *                          (parent invalidation only when the run is bound)
 *   - experiment-change  → ['experiments'], ['experiments', project],
 *                          ['experiment', id]
 *   - anomaly            → ['anomalies', project]
 *
 * Mount this hook ONCE at the top of the React tree (e.g. inside Providers).
 */
export function useMemonEvents() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const seenRunIds = new Set<string>()
    const seenExpIds = new Set<string>()

    // Pre-populate from any list cache that's already loaded
    const initialRuns = queryClient.getQueryData<{ experiments: IndexedRun[] }>([
      'runs',
    ])
    if (initialRuns?.experiments) {
      for (const e of initialRuns.experiments) seenRunIds.add(e.id)
    }

    const unsubscribe = subscribeMemonEvents((evt) => {
      switch (evt.topic) {
        case 'run-change': {
          if (!evt.id) return
          queryClient.invalidateQueries({ queryKey: ['runs'] })
          queryClient.invalidateQueries({ queryKey: ['run', evt.id] })
          if (evt.parentExperimentId) {
            queryClient.invalidateQueries({
              queryKey: ['experiment', evt.parentExperimentId],
            })
          }
          if (evt.type === 'set' && !seenRunIds.has(evt.id)) {
            seenRunIds.add(evt.id)
            toast.info(`New run: ${evt.id}`, {
              description: evt.experiment?.frontMatter?.name,
            })
          }
          return
        }
        case 'experiment-change': {
          // Coarse 'rediscover' signal carries no id — invalidate the lists.
          queryClient.invalidateQueries({ queryKey: ['experiments'] })
          if (evt.project) {
            queryClient.invalidateQueries({ queryKey: ['experiments', evt.project] })
          }
          if (evt.id) {
            queryClient.invalidateQueries({ queryKey: ['experiment', evt.id] })
            if (evt.type === 'set' && !seenExpIds.has(evt.id)) {
              seenExpIds.add(evt.id)
              toast.info(`New experiment: ${evt.id}`, {
                description: evt.experiment?.frontMatter?.title,
              })
            }
          }
          return
        }
        case 'anomaly': {
          queryClient.invalidateQueries({ queryKey: ['anomalies', evt.project] })
          queryClient.invalidateQueries({ queryKey: ['anomalies'] })
          return
        }
      }
    })

    return unsubscribe
  }, [queryClient])
}
