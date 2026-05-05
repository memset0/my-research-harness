// GET  /api/experiments/:id/warnings        — list parsed warnings + mtime + hash
// POST /api/experiments/:id/warnings        — append a new OPEN row
//
// Both go through `assertWithinProjectRoots()` (inside the warnings helper)
// before any filesystem access. POST appends a `[WARNING]` JOURNAL event
// with op=add.

import { NextResponse, type NextRequest } from 'next/server'
import { getRuntime } from '../../../../../lib/runtime'
import { addWarning, listWarnings, WarningHttpError } from '../../../../../lib/warnings'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const rt = await getRuntime()
    const { id } = await ctx.params
    const out = await listWarnings(rt, id)
    return NextResponse.json({ ok: true, ...out })
  } catch (err) {
    if (err instanceof WarningHttpError) {
      return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status })
    }
    return NextResponse.json({ error: { message: (err as Error).message } }, { status: 500 })
  }
}

interface PostBody {
  category: string
  message: string
  expectedMtime?: number
  expectedHash?: string
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const rt = await getRuntime()
    const { id } = await ctx.params
    const body = (await req.json()) as PostBody
    if (!body || typeof body.category !== 'string' || typeof body.message !== 'string') {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'category and message are required' } },
        { status: 400 },
      )
    }
    const out = await addWarning(rt, id, body)
    return NextResponse.json({ ok: true, ...out })
  } catch (err) {
    if (err instanceof WarningHttpError) {
      const payload = err.payload ? { error: { code: err.code, message: err.message }, ...err.payload } : { error: { code: err.code, message: err.message } }
      return NextResponse.json(payload, { status: err.status })
    }
    return NextResponse.json({ error: { message: (err as Error).message } }, { status: 500 })
  }
}
