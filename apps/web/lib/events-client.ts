// Singleton EventSource wrapper.
//
// All components subscribing to live updates go through this module so the
// browser opens exactly one `text/event-stream` connection per tab. The
// connection auto-opens when the first listener subscribes and auto-closes
// when the last one leaves.

import type { ExperimentDocSummary, IndexedRun } from './api'

/**
 * Run-edit event — fires when a run README / status / archive flag changes.
 * v3: lives on the `run-change` SSE topic only. The v2 `experiment-change`
 * alias for run edits has been removed.
 */
export interface RunChangeEvent {
  type: 'set' | 'delete'
  id: string
  experiment?: IndexedRun
  /**
   * Parent exp-doc id when the run is bound, else null. Lets the
   * `useMemonEvents()` hook also invalidate `['experiment', parentId]`
   * so an open exp detail page refreshes when one of its member runs
   * changes.
   */
  parentExperimentId?: string | null
}

/**
 * v3 experiment-doc event — fires when `<projectRoot>/docs/experiments/E*-…md`
 * is created, edited, or deleted. `type: 'rediscover'` is a coarse signal
 * that the project's exp-doc set was rescanned (no per-id payload).
 *
 * v3: lives on the `experiment-change` SSE topic. The pre-cutover code
 * used `experiment-doc-change` to disambiguate from the legacy run alias;
 * after `v3-spec-sync` shipped the alias is gone, so the topic name is
 * unambiguous.
 */
export interface ExperimentDocChangeEvent {
  type: 'set' | 'delete' | 'rediscover'
  id?: string
  project?: string
  experiment?: ExperimentDocSummary
}

/** v3 anomaly event — fires after `recomputeAnomalies(project)`. */
export interface AnomalyEvent {
  project: string
  count: number
}

/**
 * Code-review change event — fires after the code-reviews cache updates for a
 * project (a doc added/removed/edited, or a progress checkbox toggled).
 */
export interface CodeReviewsChangeEvent {
  project: string
}

/**
 * Discriminated union of all SSE events the client cares about. Each
 * payload carries a `topic` so listeners can fan out by type without a
 * separate subscription per topic.
 */
export type MemonEvent =
  | ({ topic: 'run-change' } & RunChangeEvent)
  | ({ topic: 'experiment-change' } & ExperimentDocChangeEvent)
  | ({ topic: 'anomaly' } & AnomalyEvent)
  | ({ topic: 'code-reviews-change' } & CodeReviewsChangeEvent)

/**
 * @deprecated Pre-v3 code used `ExperimentChangeEvent` to mean a run edit.
 * Use {@link RunChangeEvent} instead. The alias survives at type level
 * so import sites keep compiling during the rename, but it now resolves
 * to the run-edit shape (same as before) — there is no run-event payload
 * carried on the SSE `experiment-change` topic anymore.
 */
export type ExperimentChangeEvent = RunChangeEvent

type Listener = (evt: MemonEvent) => void

let source: EventSource | null = null
const listeners = new Set<Listener>()

function dispatch(evt: MemonEvent) {
  for (const l of listeners) {
    try {
      l(evt)
    } catch {
      // Listener errors must not break delivery to other subscribers.
    }
  }
}

function parseAndDispatch<T extends MemonEvent['topic']>(
  topic: T,
  raw: string,
): void {
  try {
    const payload = JSON.parse(raw)
    dispatch({ topic, ...payload } as MemonEvent)
  } catch {
    // Ignore malformed payloads
  }
}

function ensureConnected() {
  if (source || typeof window === 'undefined') return
  source = new EventSource('/api/events')
  source.addEventListener('run-change', (e) => {
    parseAndDispatch('run-change', (e as MessageEvent).data)
  })
  source.addEventListener('experiment-change', (e) => {
    parseAndDispatch('experiment-change', (e as MessageEvent).data)
  })
  source.addEventListener('anomaly', (e) => {
    parseAndDispatch('anomaly', (e as MessageEvent).data)
  })
  source.addEventListener('code-reviews-change', (e) => {
    parseAndDispatch('code-reviews-change', (e as MessageEvent).data)
  })
  // EventSource auto-reconnects on network drops; nothing extra to do here.
}

function maybeDisconnect() {
  if (source && listeners.size === 0) {
    source.close()
    source = null
  }
}

export function subscribeMemonEvents(listener: Listener): () => void {
  listeners.add(listener)
  ensureConnected()
  return () => {
    listeners.delete(listener)
    maybeDisconnect()
  }
}
