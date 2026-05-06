// POST /api/experiments/:id/link — bind a run to this experiment doc.
//
// Body: { run: string } — the run dir base name to link.
//
// Emits `[BIND] op=link run=…`. Errors:
//   - 404 NOT_FOUND on unknown experiment or run
//   - 409 BAD_STATE when the run already claims a different experiment

import { NextResponse, type NextRequest } from 'next/server'
import { getRuntime } from '../../../../../lib/runtime'
import { ExperimentHttpError, linkRun } from '../../../../../lib/experiments'

export const dynamic = 'force-dynamic'

interface PostBody {
  run: string
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const rt = await getRuntime()
    const { id } = await ctx.params
    const body = (await req.json()) as PostBody
    if (typeof body.run !== 'string' || body.run === '') {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'run is required' } },
        { status: 400 },
      )
    }
    const out = await linkRun(rt, id, body)
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
