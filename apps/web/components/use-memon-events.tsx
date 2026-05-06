'use client'

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { subscribeMemonEvents } from '../lib/events-client'
import type { IndexedRun } from '../lib/api'

/**
 * Subscribes to /api/events SSE and invalidates the relevant TanStack Query
 * caches when v3 events arrive. Toasts when a previously unknown experiment
 * (run or exp doc) shows up.
 *
 * Topic → invalidations:
 *   - run-change             → ['experiments'], ['experiment', id]
 *   - experiment-doc-change  → ['experiment-docs'], ['experiments', project],
 *                              ['experiment-doc', id]
 *   - anomaly                → ['anomalies', project]
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
      'experiments',
    ])
    if (initialRuns?.experiments) {
      for (const e of initialRuns.experiments) seenRunIds.add(e.id)
    }

    const unsubscribe = subscribeMemonEvents((evt) => {
      switch (evt.topic) {
        case 'run-change': {
          if (!evt.id) return
          queryClient.invalidateQueries({ queryKey: ['experiments'] })
          queryClient.invalidateQueries({ queryKey: ['experiment', evt.id] })
          queryClient.invalidateQueries({ queryKey: ['run', evt.id] })
          if (evt.type === 'set' && !seenRunIds.has(evt.id)) {
            seenRunIds.add(evt.id)
            toast.info(`New run: ${evt.id}`, {
              description: evt.experiment?.frontMatter?.name,
            })
          }
          return
        }
        case 'experiment-doc-change': {
          // Coarse 'rediscover' signal carries no id — invalidate the lists.
          queryClient.invalidateQueries({ queryKey: ['experiment-docs'] })
          if (evt.project) {
            queryClient.invalidateQueries({ queryKey: ['experiment-docs', evt.project] })
          }
          if (evt.id) {
            queryClient.invalidateQueries({ queryKey: ['experiment-doc', evt.id] })
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
