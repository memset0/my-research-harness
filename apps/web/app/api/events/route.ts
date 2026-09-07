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
// Standalone viewer filtering retains the existing project-name scope. Central
// viewers use exact Host-qualified ProjectRef scopes; legacy project names
// alone never authorize cross-Host events.

import type { EventEmitter } from 'node:events'
import type { ProjectRef } from '@memon/core'
import { CentralEventSchema, type Run } from '@memon/core'
import type { NextRequest } from 'next/server'
import { readIdentityFromRequest } from '@/lib/auth/request-context'
import { getRuntime } from '../../../lib/runtime'

export const dynamic = 'force-dynamic'

const STANDALONE_TOPICS = [
  'run-change',
  'experiment-change',
  'journal-change',
  'anomaly',
  'code-reviews-change',
  'wiki-change',
  'wiki-review-change',
] as const
type StandaloneTopic = (typeof STANDALONE_TOPICS)[number]

function eventProject(topic: StandaloneTopic, evt: unknown): string | null {
  if (!evt || typeof evt !== 'object') return null
  const e = evt as Record<string, unknown>
  if (
    topic === 'anomaly' ||
    topic === 'code-reviews-change' ||
    topic === 'journal-change' ||
    topic === 'wiki-change' ||
    topic === 'wiki-review-change'
  ) {
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

export interface EventsReadableStreamOptions {
  events: EventEmitter
  central: boolean
  role: 'owner' | 'viewer' | 'anon'
  scopeProjects: ReadonlySet<string>
  scopeProjectRefs?: readonly ProjectRef[]
}

export function createEventsReadableStream(options: EventsReadableStreamOptions): ReadableStream {
  const encoder = new TextEncoder()
  const listeners: Array<[string, (event: unknown) => void]> = []

  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`event: ready\ndata: {}\n\n`))
      const send = (event: string, payload: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`),
          )
        } catch {
          // controller closed — listener will be removed by cancel().
        }
      }

      if (options.central) {
        if (options.role === 'anon') return
        const listener = (input: unknown) => {
          const event = CentralEventSchema.safeParse(input)
          if (!event.success) return
          const eventData = event.data
          if (options.role === 'viewer') {
            const scopes = options.scopeProjectRefs ?? []
            const authorized =
              eventData.kind === 'host-resync'
                ? scopes.some((scope) => scope.host === eventData.host)
                : scopes.some(
                    (scope) => scope.host === eventData.host && scope.project === eventData.project,
                  )
            if (!authorized) return
          }
          if (eventData.kind === 'host-resync') {
            send('host-resync', {
              host: eventData.host,
              reason: eventData.reason,
              emittedAt: eventData.emittedAt,
            })
            return
          }
          send(eventData.topic, {
            ...eventData.data,
            host: eventData.host,
            project: eventData.project,
          })
        }
        listeners.push(['central-event', listener])
        options.events.on('central-event', listener)
        return
      }

      for (const topic of STANDALONE_TOPICS) {
        const listener = (event: unknown) => {
          if (options.role === 'viewer') {
            const project = eventProject(topic, event)
            if (!project || !options.scopeProjects.has(project)) return
          }
          send(topic, event)
        }
        listeners.push([topic, listener])
        options.events.on(topic, listener)
      }
    },
    cancel() {
      for (const [topic, listener] of listeners) options.events.off(topic, listener)
      listeners.length = 0
    },
  })
}

export async function GET(req: NextRequest) {
  const rt = await getRuntime()
  const { role, scopeProjects, scopeProjectRefs } = readIdentityFromRequest(req)
  const stream = createEventsReadableStream({
    events: rt.events,
    central: rt.config.central !== undefined,
    role,
    scopeProjects,
    scopeProjectRefs,
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
