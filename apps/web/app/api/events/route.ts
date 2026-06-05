// GET /api/events
//
// SSE stream pushing index updates as they happen (driven by the runtime's
// poller + writer hooks). Frontend uses this to invalidate its TanStack
// Query caches without polling every endpoint manually.
//
// v3 topics:
//   - run-change         : fires on RUN edits (frontmatter / body / status /
//                          link change). Payload includes `parentExperimentId`
//                          when the run is bound, so the client can invalidate
//                          the parent exp's detail cache too.
//   - experiment-change  : fires on EXPERIMENT-DOC edits/creates/deletes/binds
//                          (`docs/experiments/E*-<slug>.md`).
//   - anomaly            : fires after the runtime recomputes the membership
//                          anomaly set for a project. Payload: `{project,count}`.
//
// Viewer-mode filtering: viewer sessions receive only events for projects
// in `req.scopeProjects`. Events for other projects are dropped at the
// publish site (no need to broadcast them only to drop them client-side).

import type { NextRequest } from 'next/server'
import type { Run } from '@memon/core'
import { getRuntime } from '../../../lib/runtime'
import { readIdentityFromRequest } from '@/lib/auth/request-context'

export const dynamic = 'force-dynamic'

const TOPICS = ['run-change', 'experiment-change', 'anomaly', 'code-reviews-change'] as const
type Topic = (typeof TOPICS)[number]

function eventProject(topic: Topic, evt: unknown): string | null {
  if (!evt || typeof evt !== 'object') return null
  const e = evt as Record<string, unknown>
  if (topic === 'anomaly' || topic === 'code-reviews-change') {
    return typeof e.project === 'string' ? e.project : null
  }
  if (topic === 'experiment-change') {
    if (typeof e.project === 'string') return e.project
    const exp = e.experiment as { project?: string } | undefined
    return exp?.project ?? null
  }
  if (topic === 'run-change') {
    const run = e.experiment as Run | undefined
    return run?.project ?? null
  }
  return null
}

export async function GET(req: NextRequest) {
  const rt = await getRuntime()
  const { role, scopeProjects } = readIdentityFromRequest(req)
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
        const h = (evt: unknown) => {
          if (role === 'viewer') {
            const proj = eventProject(topic, evt)
            if (!proj || !scopeProjects.has(proj)) return
          }
          send(topic, evt)
        }
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
