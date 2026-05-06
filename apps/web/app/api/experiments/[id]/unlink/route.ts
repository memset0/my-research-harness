// POST /api/experiments/:id/unlink — release a run from this experiment doc.
//
// Body: { run: string } — the run dir base name to unlink.
//
// Emits `[BIND] op=unlink run=…`. The run's frontmatter `experiment` is
// cleared if it pointed at this exp; the exp's `runs[]` is filtered.

import { NextResponse, type NextRequest } from 'next/server'
import { getRuntime } from '../../../../../lib/runtime'
import { ExperimentHttpError, unlinkRun } from '../../../../../lib/experiments'

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
    const out = await unlinkRun(rt, id, body)
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
