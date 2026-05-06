// PATCH  /api/experiments/:id/warnings/:rowId
//        body: { op: 'resolve' | 'reopen', note?, expectedMtime, expectedHash }
// DELETE /api/experiments/:id/warnings/:rowId
//        body: { expectedMtime, expectedHash }
//
// v3 exp-doc target — see ../route.ts header for the routing distinction
// from /api/runs/:id/warnings/:rowId.

import { NextResponse, type NextRequest } from 'next/server'
import { getRuntime } from '../../../../../../lib/runtime'
import {
  deleteExpDocWarning,
  patchExpDocWarning,
  WarningHttpError,
} from '../../../../../../lib/warnings'

export const dynamic = 'force-dynamic'

interface PatchBody {
  op: 'resolve' | 'reopen'
  note?: string
  expectedMtime?: number
  expectedHash?: string
}

interface DeleteBody {
  expectedMtime?: number
  expectedHash?: string
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; rowId: string }> },
) {
  try {
    const rt = await getRuntime()
    const { id, rowId } = await ctx.params
    const body = (await req.json()) as PatchBody
    if (!body || (body.op !== 'resolve' && body.op !== 'reopen')) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'op must be "resolve" or "reopen"' } },
        { status: 400 },
      )
    }
    const out = await patchExpDocWarning(rt, id, rowId, body)
    return NextResponse.json({ ok: true, ...out })
  } catch (err) {
    if (err instanceof WarningHttpError) {
      const payload = err.payload
        ? { error: { code: err.code, message: err.message }, ...err.payload }
        : { error: { code: err.code, message: err.message } }
      return NextResponse.json(payload, { status: err.status })
    }
    return NextResponse.json({ error: { message: (err as Error).message } }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; rowId: string }> },
) {
  try {
    const rt = await getRuntime()
    const { id, rowId } = await ctx.params
    let body: DeleteBody = {}
    try {
      body = (await req.json()) as DeleteBody
    } catch {
      // DELETE body is optional
    }
    const out = await deleteExpDocWarning(rt, id, rowId, body)
    return NextResponse.json({ ok: true, ...out })
  } catch (err) {
    if (err instanceof WarningHttpError) {
      const payload = err.payload
        ? { error: { code: err.code, message: err.message }, ...err.payload }
        : { error: { code: err.code, message: err.message } }
      return NextResponse.json(payload, { status: err.status })
    }
    return NextResponse.json({ error: { message: (err as Error).message } }, { status: 500 })
  }
}
