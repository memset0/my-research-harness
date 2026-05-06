// GET /api/events
//
// SSE stream pushing index updates as they happen (driven by the runtime's
// poller + writer hooks). Frontend uses this to invalidate its TanStack
// Query caches without polling every endpoint manually.
//
// Topics (v3, task 9.13):
//   - experiment-change       : v2-legacy, fires on RUN edits. Deprecated
//                               alias for `run-change`. Will be removed in
//                               a future release; new clients MUST migrate
//                               to `run-change`.
//   - run-change              : fires on RUN edits (same payload as the
//                               legacy `experiment-change`).
//   - experiment-doc-change   : fires on v3 EXPERIMENT DOC edits/creates/
//                               deletes (`docs/experiments/E*-<slug>.md`).
//   - anomaly                 : fires after the runtime recomputes the
//                               membership anomaly set for a project.
//                               Payload: { project: string }.

import type { NextRequest } from 'next/server'
import { getRuntime } from '../../../lib/runtime'

export const dynamic = 'force-dynamic'

const TOPICS = ['experiment-change', 'experiment-doc-change', 'anomaly'] as const
type Topic = (typeof TOPICS)[number]

export async function GET(_req: NextRequest) {
  const rt = await getRuntime()
  const encoder = new TextEncoder()

  const handlers = new Map<Topic, (evt: unknown) => void>()

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`event: ready\ndata: {}\n\n`))
      const send = (event: string, evt: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(evt)}\n\n`))
        } catch {
          // controller closed — listener will be removed by cancel()
        }
      }
      // experiment-change is emitted internally for run edits. Forward to
      // both the legacy topic name AND the new `run-change` so v3-aware
      // clients can subscribe to the canonical name without breaking the
      // v2 listeners that still use `experiment-change`.
      const onRun = (evt: unknown) => {
        send('experiment-change', evt)
        send('run-change', evt)
      }
      handlers.set('experiment-change', onRun)
      rt.events.on('experiment-change', onRun)

      const onExpDoc = (evt: unknown) => send('experiment-doc-change', evt)
      handlers.set('experiment-doc-change', onExpDoc)
      rt.events.on('experiment-doc-change', onExpDoc)

      const onAnomaly = (evt: unknown) => send('anomaly', evt)
      handlers.set('anomaly', onAnomaly)
      rt.events.on('anomaly', onAnomaly)
    },
    cancel() {
      for (const [topic, h] of handlers) rt.events.off(topic, h)
      handlers.clear()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
