// GET /api/events
//
// SSE stream pushing index updates as they happen (driven by the runtime's
// poller + writer hooks). Frontend uses this to invalidate its TanStack
// Query caches without polling every endpoint manually.
//
// v3 topics (task 9.13 + v3-spec-sync):
//   - run-change         : fires on RUN edits (frontmatter / body / status /
//                          link change). Payload includes `parentExperimentId`
//                          when the run is bound, so the client can invalidate
//                          the parent exp's detail cache too.
//   - experiment-change  : fires on EXPERIMENT-DOC edits/creates/deletes/binds
//                          (`docs/experiments/E*-<slug>.md`).
//   - anomaly            : fires after the runtime recomputes the membership
//                          anomaly set for a project. Payload: `{project,count}`.
//
// The v2 alias `experiment-change` for run edits has been removed — the topic
// name now means exp-doc events ONLY. Clients still on the legacy semantics
// MUST migrate to `run-change`. See live-updates spec.

import type { NextRequest } from 'next/server'
import { getRuntime } from '../../../lib/runtime'

export const dynamic = 'force-dynamic'

const TOPICS = ['run-change', 'experiment-change', 'anomaly'] as const
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
      for (const topic of TOPICS) {
        const h = (evt: unknown) => send(topic, evt)
        handlers.set(topic, h)
        rt.events.on(topic, h)
      }
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
