// PUT /api/experiments/:id/readme — write a v3 experiment doc README with
// optimistic mtime+hash locking; emits `[EXPERIMENT] op=edit` on success.
//
// Body: { content: string, expectedMtime: number, expectedHash?: string }
//
// Distinct from PUT /api/runs/:id/readme (target = run README) and the
// legacy PUT /api/readme (target = absolute path; v2 alias). Use this for
// any v3 exp-doc edits made from the web UI.

import { NextResponse, type NextRequest } from 'next/server'
import { getRuntime } from '../../../../../lib/runtime'
import { ExperimentHttpError, writeExperimentReadme } from '../../../../../lib/experiments'

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
    const out = await writeExperimentReadme(rt, id, body)
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
