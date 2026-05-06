// Singleton EventSource wrapper.
//
// All components subscribing to live updates go through this module so the
// browser opens exactly one `text/event-stream` connection per tab. The
// connection auto-opens when the first listener subscribes and auto-closes
// when the last one leaves.

import type { ExperimentDocSummary, IndexedRun } from './api'

/**
 * Run-edit event — fires when a run README / status / archive flag changes.
 * Carried on both the new `run-change` topic AND the legacy
 * `experiment-change` topic (deprecated alias kept by the SSE encoder for
 * back-compat with v2 clients during the migration window).
 */
export interface RunChangeEvent {
  type: 'set' | 'delete'
  id: string
  experiment?: IndexedRun
}

/**
 * v3 experiment-doc event — fires when `<projectRoot>/docs/experiments/E*-…md`
 * is created, edited, or deleted. `type: 'rediscover'` is a coarse signal
 * that the project's exp-doc set was rescanned (no per-id payload).
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
 * Discriminated union of all SSE events the client cares about. Each
 * payload carries a `topic` so listeners can fan out by type without a
 * separate subscription per topic.
 */
export type MemonEvent =
  | ({ topic: 'run-change' } & RunChangeEvent)
  | ({ topic: 'experiment-doc-change' } & ExperimentDocChangeEvent)
  | ({ topic: 'anomaly' } & AnomalyEvent)

/**
 * @deprecated v2 alias. New code should consume {@link MemonEvent} via
 * {@link subscribeMemonEvents} and switch on `evt.topic`. The legacy alias
 * is preserved so existing imports of `ExperimentChangeEvent` keep
 * compiling during the v3 migration window — payload shape is identical
 * to {@link RunChangeEvent}.
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
  // New v3 topic; preferred path.
  source.addEventListener('run-change', (e) => {
    parseAndDispatch('run-change', (e as MessageEvent).data)
  })
  // Legacy alias for `run-change`. Kept so the existing v2 listeners on
  // this single subscription point still work; once all callers consume
  // `run-change` we can drop this.
  source.addEventListener('experiment-change', (e) => {
    parseAndDispatch('run-change', (e as MessageEvent).data)
  })
  source.addEventListener('experiment-doc-change', (e) => {
    parseAndDispatch('experiment-doc-change', (e as MessageEvent).data)
  })
  source.addEventListener('anomaly', (e) => {
    parseAndDispatch('anomaly', (e as MessageEvent).data)
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
