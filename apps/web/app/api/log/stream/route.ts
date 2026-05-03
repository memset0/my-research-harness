// GET /api/log/stream?path=PATH
//
// SSE: emits `append` events when new lines are detected, until the client
// disconnects. The stream polls the file via the runtime's existing poller
// pattern (we share the same poller instance through the runtime).

import { type NextRequest, NextResponse } from 'next/server'
import { LineIndex } from '@memon/core'
import { getRuntime } from '../../../../lib/runtime'
import { PathSafetyError, assertWithinProjectRoots } from '../../../../lib/path-safety'

export const dynamic = 'force-dynamic'

const STREAM_POLL_MS = 1500

export async function GET(req: NextRequest) {
  try {
    const rt = await getRuntime()
    const url = new URL(req.url)
    const path = url.searchParams.get('path')
    if (!path) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'path query parameter required' } },
        { status: 400 },
      )
    }
    let safePath: string
    try {
      safePath = assertWithinProjectRoots(path, rt.config)
    } catch (err) {
      if (err instanceof PathSafetyError) {
        return NextResponse.json({ error: { code: 'FORBIDDEN', message: err.message } }, { status: 403 })
      }
      throw err
    }

    const encoder = new TextEncoder()
    let closed = false
    let interval: NodeJS.Timeout | null = null

    const stream = new ReadableStream({
      async start(controller) {
        const index = await LineIndex.build(safePath)
        controller.enqueue(
          encoder.encode(`event: ready\ndata: ${JSON.stringify({ totalLines: index.totalLines })}\n\n`),
        )

        const tick = async () => {
          if (closed) return
          try {
            const r = await index.appendDelta()
            if (r.rotated) {
              controller.enqueue(encoder.encode(`event: rotated\ndata: {}\n\n`))
              return
            }
            if (r.added > 0) {
              const lines = await index.range(index.totalLines, r.added)
              controller.enqueue(
                encoder.encode(`event: append\ndata: ${JSON.stringify({ lines })}\n\n`),
              )
            }
          } catch (err) {
            controller.enqueue(
              encoder.encode(`event: error\ndata: ${JSON.stringify({ message: (err as Error).message })}\n\n`),
            )
          }
        }

        interval = setInterval(tick, STREAM_POLL_MS)
        // Keep the timer non-blocking for process exit
        ;(interval as NodeJS.Timeout & { unref?: () => void }).unref?.()
      },
      cancel() {
        closed = true
        if (interval) clearInterval(interval)
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    })
  } catch (err) {
    return NextResponse.json({ error: { message: (err as Error).message } }, { status: 500 })
  }
}
