'use client'

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { subscribeMemonEvents } from '../lib/events-client'
import type { IndexedRun } from '../lib/api'

/**
 * Subscribes to /api/events SSE and invalidates TanStack Query caches when
 * experiment-change events arrive. Toasts when a previously unknown
 * experiment shows up.
 *
 * Mount this hook ONCE at the top of the React tree (e.g. inside Providers).
 */
export function useMemonEvents() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const seenIds = new Set<string>()

    // Pre-populate from any list cache that's already loaded
    const initial = queryClient.getQueryData<{ experiments: IndexedRun[] }>([
      'experiments',
    ])
    if (initial?.experiments) {
      for (const e of initial.experiments) seenIds.add(e.id)
    }

    const unsubscribe = subscribeMemonEvents((evt) => {
      if (!evt.id) return

      queryClient.invalidateQueries({ queryKey: ['experiments'] })
      queryClient.invalidateQueries({ queryKey: ['experiment', evt.id] })

      if (evt.type === 'set' && !seenIds.has(evt.id)) {
        seenIds.add(evt.id)
        toast.info(`New experiment: ${evt.id}`, {
          description: evt.experiment?.frontMatter?.name,
        })
      }
    })

    return unsubscribe
  }, [queryClient])
}
