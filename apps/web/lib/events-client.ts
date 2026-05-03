// Singleton EventSource wrapper.
//
// All components subscribing to live updates go through this module so the
// browser opens exactly one `text/event-stream` connection per tab. The
// connection auto-opens when the first listener subscribes and auto-closes
// when the last one leaves.

import type { IndexedExperiment } from './api'

export interface ExperimentChangeEvent {
  type: 'set' | 'delete'
  id: string
  experiment?: IndexedExperiment
}

type Listener = (evt: ExperimentChangeEvent) => void

let source: EventSource | null = null
const listeners = new Set<Listener>()

function dispatch(evt: ExperimentChangeEvent) {
  for (const l of listeners) {
    try {
      l(evt)
    } catch {
      // Listener errors must not break delivery to other subscribers.
    }
  }
}

function ensureConnected() {
  if (source || typeof window === 'undefined') return
  source = new EventSource('/api/events')
  source.addEventListener('experiment-change', (e) => {
    try {
      const payload = JSON.parse((e as MessageEvent).data) as ExperimentChangeEvent
      dispatch(payload)
    } catch {
      // Ignore malformed payloads
    }
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
