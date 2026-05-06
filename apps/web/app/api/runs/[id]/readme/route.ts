// PUT /api/runs/:id/readme — write a v3 run README with optimistic
// mtime+hash locking; emits `[STATUS]` on success when the front-matter
// status changed.
//
// Body: { content: string, expectedMtime: number, expectedHash?: string }
//
// v3 replacement for the legacy PUT /api/readme (which took an absolute
// `path`). The id-addressed form lets the web layer enforce path safety
// without trusting client-supplied paths.

import { NextResponse, type NextRequest } from 'next/server'
import { getRuntime } from '../../../../../lib/runtime'
import { ExperimentHttpError, writeRunReadme } from '../../../../../lib/experiments'

export const dynamic = 'force-dynamic'

interface PutBody {
  content: string
  expectedMtime: number
  expectedHash?: string
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const rt = await getRuntime()
    const { id } = await ctx.params
    const body = (await req.json()) as PutBody
    if (typeof body.content !== 'string' || typeof body.expectedMtime !== 'number') {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'content and expectedMtime are required' } },
        { status: 400 },
      )
    }
    const out = await writeRunReadme(rt, id, body)
    return NextResponse.json({ ok: true, ...out })
  } catch (err) {
    if (err instanceof ExperimentHttpError) {
      const payload = err.payload
        ? { error: { code: err.code, message: err.message }, ...err.payload }
        : { error: { code: err.code, message: err.message } }
      return NextResponse.json(payload, { status: err.status })
    }
    return NextResponse.json({ error: { message: (err as Error).message } }, { status: 500 })
  }
}
