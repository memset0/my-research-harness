'use client'

// One shared foreground heartbeat for the whole dashboard.
//
// Instead of a refetch interval per query (and a second timer per table), the
// tree mounts this coordinator once. While the tab is visible AND focused it
// refetches active resource queries, tagging the batch with a reason so the
// server-side file store can separate document demand from automatic upkeep.
// Hidden or unfocused tabs issue no requests at all, and nothing is cancelled
// when they go away — the attention lease simply expires.
//
// Cadence is completion-relative, never a fixed interval: at most one pulse is
// ever in flight, and the next automatic one is armed only when that pulse has
// settled (success or failure) and the tab is still in front. A slow or failing
// server therefore cannot accumulate a backlog of overlapping requests, and a
// completion landing after a blur or unmount does not resurrect a stopped loop.
// Focus and manual document pulses join the request already in flight instead
// of queueing a second one. Collection queries wait for the automatic timer.
//
// Reasons:
//   open      first document requests after a navigation (mount fetches)
//   focus     the tab became visible and focused again; documents only
//   manual    the reader pressed a refresh control; documents only
//   heartbeat the shared completion-relative timer; documents and collections
//
// Run README bodies are deliberately excluded (see RUN_BODY_QUERY_ROOTS): they
// load once and on explicit manual refresh, never on heartbeat, focus, or a
// parent list update.

import { useQueryClient } from '@tanstack/react-query'
import { usePathname } from 'next/navigation'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { toast } from 'sonner'
import { isCollectionResourceQuery } from '../lib/resource-policy'
import {
  consumeResourceChanges,
  getResourceStatusSnapshot,
  getServerResourceStatusSnapshot,
  markResourceOpen,
  type PageResourceStatus,
  type ResourceReason,
  subscribeResourceStatus,
  withResourceReason,
} from '../lib/resource-protocol'
import { useRuntimeConfig } from '../lib/runtime-config'

/**
 * Query-key roots that follow the shared resource lifecycle: documents, lists
 * and the metadata views projected from them.
 */
const RESOURCE_QUERY_ROOTS: Record<string, true> = {
  'code-review': true,
  'code-reviews': true,
  'code-reviews-inventory': true,
  digest: true,
  digests: true,
  'digests-inventory': true,
  experiment: true,
  experiments: true,
  'experiments-inventory': true,
  'file-access': true,
  hosts: true,
  hypotheses: true,
  journal: true,
  'journal-count': true,
  'journal-history': true,
  projects: true,
  report: true,
  reports: true,
  'reports-inventory': true,
  runs: true,
  'runs-inventory': true,
  wiki: true,
  'wiki-inventory': true,
  'wiki-backlinks': true,
  'wiki-page': true,
}

/**
 * Run README bodies and their file listings. Excluded on purpose — a Run body
 * on screen must not change under the reader while its list refreshes.
 */
const RUN_BODY_QUERY_ROOTS: Record<string, true> = {
  run: true,
  'run-files': true,
}

export function isResourceQueryKey(queryKey: readonly unknown[]): boolean {
  const root = queryKey[0]
  if (typeof root !== 'string') return false
  if (RUN_BODY_QUERY_ROOTS[root]) return false
  return RESOURCE_QUERY_ROOTS[root] === true
}

/**
 * How long after a navigation mount fetches still count as human page-open
 * demand. Long enough to cover a slow first render, short enough that the next
 * automatic tick is not mislabelled.
 */
const OPEN_WINDOW_MS = 2_000

/**
 * One refetch batch. Resolves when the batch has settled, so a caller that
 * joins the pulse in flight sees the same completion.
 */
type PulseFn = (reason: ResourceReason, skipRecentMs?: number) => Promise<void>

interface ResourceHeartbeat {
  /** Verify the current page's resources now. */
  refresh: (reason?: Extract<ResourceReason, 'manual' | 'focus'>) => void
  /** A pulse is in flight. */
  refreshing: boolean
  /** The tab is visible and focused, so the heartbeat is running. */
  foreground: boolean
  heartbeatMs: number
  /** Increments after every pulse; age labels re-render off this. */
  tick: number
}

const HeartbeatContext = createContext<ResourceHeartbeat | null>(null)

const INERT_HEARTBEAT: ResourceHeartbeat = {
  refresh: () => undefined,
  refreshing: false,
  foreground: false,
  heartbeatMs: 0,
  tick: 0,
}

export function ResourceHeartbeatProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const { fileAccess } = useRuntimeConfig()
  const heartbeatMs = fileAccess.heartbeatMs
  const pathname = usePathname()
  const [foreground, setForeground] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [tick, setTick] = useState(0)
  // At most one pulse in flight, shared by every caller: a joiner awaits this
  // promise rather than starting (or queueing) a second request.
  const inFlight = useRef<Promise<void> | null>(null)
  const timer = useRef<number | null>(null)
  // Read by pulse completions, which may land long after the render that
  // produced them.
  const foregroundRef = useRef(false)
  const cadenceRef = useRef(heartbeatMs)
  const mountedRef = useRef(true)
  const pulseRef = useRef<PulseFn | null>(null)
  const openedPath = useRef<string | null>(null)

  // Deliberately during render, not in an effect: child effects (where
  // TanStack Query starts its mount fetches) run BEFORE the provider's own
  // effects, so an effect here would tag a page's first requests as automatic.
  if (openedPath.current !== pathname) {
    openedPath.current = pathname
    markResourceOpen(OPEN_WINDOW_MS)
  }

  const clearTimer = useCallback(() => {
    if (timer.current === null) return
    window.clearTimeout(timer.current)
    timer.current = null
  }, [])

  /** Arm the next automatic pulse, measured from the previous one's end. */
  const schedule = useCallback(() => {
    clearTimer()
    if (!mountedRef.current || !foregroundRef.current) return
    timer.current = window.setTimeout(() => {
      timer.current = null
      void pulseRef.current?.('heartbeat')
    }, cadenceRef.current)
  }, [clearTimer])

  const pulse = useCallback(
    (reason: ResourceReason, skipRecentMs?: number): Promise<void> => {
      // Focus, manual and heartbeat callers all join the pulse already running.
      const running = inFlight.current
      if (running) return running
      // Any new pulse resets the cadence: the pending automatic one is dropped
      // and re-armed from this pulse's completion.
      clearTimer()
      setRefreshing(true)
      const skipBefore = skipRecentMs === undefined ? null : Date.now() - skipRecentMs
      let settled = false
      const run = (async () => {
        try {
          // `refetchQueries` starts every matching fetch synchronously, so the
          // reason scope covers the whole batch without leaking into later work.
          // Collections never join human-priority pulses; the automatic timer
          // remains responsible for refreshing active lists and inventories.
          const humanDocumentPulse = reason === 'manual' || reason === 'focus'
          await withResourceReason(reason, () =>
            queryClient.refetchQueries(
              {
                type: 'active',
                predicate: (query) =>
                  isResourceQueryKey(query.queryKey) &&
                  (!humanDocumentPulse || !isCollectionResourceQuery(query.queryKey)) &&
                  (skipBefore === null || query.state.dataUpdatedAt < skipBefore),
              },
              // Join a request that is already in flight rather than cancelling
              // and reissuing it: a heartbeat must not restart a page's own load.
              { cancelRefetch: false },
            ),
          )
        } catch {
          // Per-query errors already live in their own query state; a failed
          // batch must not stop the heartbeat.
        } finally {
          settled = true
          inFlight.current = null
          setRefreshing(false)
          setTick((previous) => previous + 1)
          // Success or failure, the loop continues — but only while this
          // provider is mounted and the tab is still in front.
          schedule()
        }
        const changed = consumeResourceChanges()
        if (changed > 0) {
          toast(changed === 1 ? 'Updated from disk' : `${changed} resources updated`, {
            duration: 2_500,
          })
        }
      })()
      // A batch that failed synchronously has already cleared itself; storing
      // the settled promise would block every later pulse.
      if (!settled) inFlight.current = run
      return run
    },
    [clearTimer, queryClient, schedule],
  )
  // The automatic timer reaches the pulse through this ref, so `schedule` does
  // not have to be re-created (and the timer re-armed) on every render.
  useEffect(() => {
    pulseRef.current = pulse
  }, [pulse])

  useEffect(() => {
    const sync = () => setForeground(document.visibilityState === 'visible' && document.hasFocus())
    sync()
    window.addEventListener('focus', sync)
    window.addEventListener('blur', sync)
    document.addEventListener('visibilitychange', sync)
    return () => {
      window.removeEventListener('focus', sync)
      window.removeEventListener('blur', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearTimer()
    }
  }, [clearTimer])

  useEffect(() => {
    foregroundRef.current = foreground
    cadenceRef.current = heartbeatMs
    if (!foreground) {
      // Hidden or unfocused: stop the loop. An in-flight pulse is left to
      // finish; its completion sees `foregroundRef` false and arms nothing.
      clearTimer()
      return
    }
    // Becoming foreground is human attention: verify stale documents straight
    // away, but leave every collection for the automatic cadence. If a pulse
    // is already running this joins it, and that pulse's completion arms the
    // next automatic one.
    void pulse('focus', heartbeatMs)
    return () => clearTimer()
  }, [foreground, heartbeatMs, pulse, clearTimer])

  const value = useMemo<ResourceHeartbeat>(
    () => ({
      refresh: (reason = 'manual') => void pulse(reason),
      refreshing,
      foreground,
      heartbeatMs,
      tick,
    }),
    [pulse, refreshing, foreground, heartbeatMs, tick],
  )

  return <HeartbeatContext.Provider value={value}>{children}</HeartbeatContext.Provider>
}

/**
 * Shared heartbeat handle. Outside the provider (unit tests, storybook mounts)
 * this is inert rather than throwing.
 */
export function useResourceHeartbeat(): ResourceHeartbeat {
  return useContext(HeartbeatContext) ?? INERT_HEARTBEAT
}

/** Aggregate freshness of every resource the current page has read. */
export function usePageResourceStatus(): PageResourceStatus {
  return useSyncExternalStore(
    subscribeResourceStatus,
    getResourceStatusSnapshot,
    getServerResourceStatusSnapshot,
  )
}
