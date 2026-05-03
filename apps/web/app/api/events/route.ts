// GET /api/events
//
// SSE stream pushing experiment-index updates as they happen (driven by the
// runtime's poller). Frontend uses this to invalidate its TanStack Query
// caches without polling every endpoint manually.

import type { NextRequest } from 'next/server'
import { getRuntime, type ExperimentChangeEvent } from '../../../lib/runtime'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest) {
  const rt = await getRuntime()
  const encoder = new TextEncoder()

  let listener: ((evt: ExperimentChangeEvent) => void) | null = null

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`event: ready\ndata: {}\n\n`))
      listener = (evt: ExperimentChangeEvent) => {
        try {
          controller.enqueue(
            encoder.encode(`event: experiment-change\ndata: ${JSON.stringify(evt)}\n\n`),
          )
        } catch {
          // controller closed — listener will be removed by cancel()
        }
      }
      rt.events.on('experiment-change', listener)
    },
    cancel() {
      if (listener) rt.events.off('experiment-change', listener)
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
