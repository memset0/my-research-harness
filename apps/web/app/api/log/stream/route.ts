// GET /api/log/stream — legacy absolute-path adapter over shared SSE polling.

import { BackendStreamServiceError } from '@memon/backend'
import { type NextRequest, NextResponse } from 'next/server'
import { PathSafetyError } from '../../../../lib/server/path-safety'
import { getRuntime } from '../../../../lib/server/runtime'
import { standaloneResource } from '../../../../lib/server/standalone-resource'
import { standaloneServices } from '../../../../lib/server/standalone-services'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const path = new URL(request.url).searchParams.get('path')
  if (!path) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'path query parameter required' } },
      { status: 400 },
    )
  }
  try {
    const runtime = await getRuntime()
    const target = standaloneResource(runtime.config, path)
    const service = standaloneServices(runtime.config).streaming
    await service.validateLogResource(target.project.name, target.resource)
    const abort = new AbortController()
    const onAbort = () => abort.abort(request.signal.reason)
    request.signal.addEventListener('abort', onAbort, { once: true })
    const iterator = service
      .streamLog(target.project.name, target.resource, abort.signal)
      [Symbol.asyncIterator]()
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const next = await iterator.next()
        if (next.done) {
          request.signal.removeEventListener('abort', onAbort)
          controller.close()
          return
        }
        controller.enqueue(
          encoder.encode(
            `event: ${next.value.event}\ndata: ${JSON.stringify(next.value.data)}\n\n`,
          ),
        )
      },
      async cancel() {
        abort.abort(new Error('standalone log stream cancelled'))
        request.signal.removeEventListener('abort', onAbort)
        await iterator.return?.()
      },
    })
    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    })
  } catch (error) {
    if (error instanceof PathSafetyError) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: error.message } },
        { status: 403 },
      )
    }
    if (error instanceof BackendStreamServiceError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.code === 'INVALID_RESOURCE' ? 400 : 404 },
      )
    }
    return NextResponse.json({ error: { message: 'log stream failed' } }, { status: 500 })
  }
}
