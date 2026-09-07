'use client'

import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { toast } from 'sonner'
import type { IndexedRun } from '../lib/api'
import { subscribeMemonEvents } from '../lib/events-client'
import { useSession } from './session-provider'

function scopedKey(host: string | undefined, root: string, ...parts: unknown[]): unknown[] {
  return host ? [root, host, ...parts] : [root, ...parts]
}

export function queryKeyContainsHost(queryKey: readonly unknown[], host: string): boolean {
  const seen = new Set<object>()
  const contains = (value: unknown): boolean => {
    if (value === host) return true
    if (!value || typeof value !== 'object') return false
    if (seen.has(value)) return false
    seen.add(value)
    if (Array.isArray(value)) return value.some(contains)
    const record = value as Record<string, unknown>
    if (record.host === host) return true
    return Object.values(record).some(contains)
  }
  return contains(queryKey)
}

export function invalidateQueriesForHost(queryClient: QueryClient, host: string): void {
  void queryClient.invalidateQueries({
    predicate: (query) => {
      const root = query.queryKey[0]
      return root === 'hosts' || root === 'projects' || queryKeyContainsHost(query.queryKey, host)
    },
  })
}

export function invalidateJournalQueries(
  queryClient: QueryClient,
  host: string | undefined,
  project: string,
): void {
  void queryClient.invalidateQueries({ queryKey: scopedKey(host, 'journal', project) })
}

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
 *   - journal-change     → ['journal', Host?, project]
 *   - anomaly            → ['anomalies', project]
 *
 * Mount this hook ONCE at the top of the React tree (e.g. inside Providers).
 */
export function useMemonEvents() {
  const queryClient = useQueryClient()
  const { role } = useSession()

  useEffect(() => {
    // The login page shares the root provider tree but has no authenticated
    // event scope. Avoid a denied background request (and its reconnect loop)
    // until an owner/viewer navigation remounts the provider.
    if (role === 'anon') return

    const seenRunIds = new Set<string>()
    const seenExpIds = new Set<string>()

    // Pre-populate from any list cache that's already loaded
    const initialRuns = queryClient.getQueryData<{ experiments: IndexedRun[] }>(['runs'])
    if (initialRuns?.experiments) {
      for (const e of initialRuns.experiments) seenRunIds.add(e.id)
    }

    const unsubscribe = subscribeMemonEvents((evt) => {
      switch (evt.topic) {
        case 'host-resync': {
          invalidateQueriesForHost(queryClient, evt.host)
          return
        }
        case 'run-change': {
          if (!evt.id) return
          queryClient.invalidateQueries({ queryKey: scopedKey(evt.host, 'runs') })
          if (evt.host && evt.project) {
            queryClient.invalidateQueries({ queryKey: scopedKey(evt.host, 'runs', evt.project) })
          }
          queryClient.invalidateQueries({ queryKey: scopedKey(evt.host, 'run', evt.id) })
          if (evt.parentExperimentId) {
            queryClient.invalidateQueries({
              queryKey: scopedKey(evt.host, 'experiment', evt.parentExperimentId),
            })
          }
          const seenId = evt.host ? `${evt.host}:${evt.id}` : evt.id
          if (evt.type === 'set' && !seenRunIds.has(seenId)) {
            seenRunIds.add(seenId)
            toast.info(`New run: ${evt.id}`, {
              description: evt.experiment?.frontMatter?.name,
            })
          }
          return
        }
        case 'experiment-change': {
          // Coarse 'rediscover' signal carries no id — invalidate the lists.
          queryClient.invalidateQueries({ queryKey: scopedKey(evt.host, 'experiments') })
          // Cited-Experiment times drive wiki staleness. Older standalone
          // emitters omit project, so fall back to the wiki-key prefix rather
          // than constructing the non-matching `['wiki', undefined]`.
          queryClient.invalidateQueries({
            queryKey: evt.project
              ? scopedKey(evt.host, 'wiki', evt.project)
              : scopedKey(evt.host, 'wiki'),
          })
          if (evt.project) {
            queryClient.invalidateQueries({
              queryKey: scopedKey(evt.host, 'experiments', evt.project),
            })
          }
          if (evt.id) {
            queryClient.invalidateQueries({
              queryKey: scopedKey(evt.host, 'experiment', evt.id),
            })
            const seenId = evt.host ? `${evt.host}:${evt.id}` : evt.id
            if (evt.type === 'set' && !seenExpIds.has(seenId)) {
              seenExpIds.add(seenId)
              toast.info(`New experiment: ${evt.id}`, {
                description: evt.experiment?.frontMatter?.title,
              })
            }
          }
          return
        }
        case 'journal-change': {
          invalidateJournalQueries(queryClient, evt.host, evt.project)
          return
        }
        case 'anomaly': {
          queryClient.invalidateQueries({
            queryKey: scopedKey(evt.host, 'anomalies', evt.project),
          })
          queryClient.invalidateQueries({ queryKey: scopedKey(evt.host, 'anomalies') })
          return
        }
        case 'code-reviews-change': {
          if (evt.project) {
            queryClient.invalidateQueries({
              queryKey: scopedKey(evt.host, 'code-reviews', evt.project),
            })
            // Prefix-match invalidates every ['code-review', project, id] too.
            queryClient.invalidateQueries({
              queryKey: scopedKey(evt.host, 'code-review', evt.project),
            })
          }
          return
        }
        case 'reports-change': {
          queryClient.invalidateQueries({
            queryKey: scopedKey(evt.host, 'reports', evt.project),
          })
          queryClient.invalidateQueries({
            queryKey: scopedKey(evt.host, 'report', evt.project),
          })
          // A removed Report hands its `R<NNNN>` token to a `legacy_id` page.
          queryClient.invalidateQueries({ queryKey: scopedKey(evt.host, 'wiki', evt.project) })
          return
        }
        case 'wiki-change': {
          queryClient.invalidateQueries({ queryKey: scopedKey(evt.host, 'wiki', evt.project) })
          queryClient.invalidateQueries({
            queryKey: scopedKey(evt.host, 'wiki-page', evt.project),
          })
          return
        }
        case 'wiki-review-change': {
          queryClient.invalidateQueries({ queryKey: scopedKey(evt.host, 'wiki', evt.project) })
          queryClient.invalidateQueries({
            queryKey: scopedKey(evt.host, 'wiki-page', evt.project),
          })
          queryClient.invalidateQueries({
            queryKey: scopedKey(evt.host, 'wiki-review', evt.project),
          })
          return
        }
        case 'digests-change': {
          queryClient.invalidateQueries({
            queryKey: scopedKey(evt.host, 'digests', evt.project),
          })
          queryClient.invalidateQueries({
            queryKey: scopedKey(evt.host, 'digest', evt.project),
          })
          return
        }
      }
    })

    return unsubscribe
  }, [queryClient, role])
}
