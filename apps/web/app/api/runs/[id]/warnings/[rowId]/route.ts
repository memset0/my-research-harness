import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '../../../../../../lib/server/runtime'
import {
  mutateStandaloneWarning,
  standaloneWarningError,
} from '../../../../../../lib/server/standalone-warning-route'

export const dynamic = 'force-dynamic'

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; rowId: string }> },
) {
  try {
    const runtime = await getRuntime()
    const { id, rowId } = await ctx.params
    const body = (await req.json()) as {
      op?: unknown
      note?: string
      expectedMtime?: number
      expectedHash?: string
    }
    if (body?.op !== 'resolve' && body?.op !== 'reopen') {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'op must be "resolve" or "reopen"' } },
        { status: 400 },
      )
    }
    if (body.op === 'resolve' && (!body.note || body.note.trim() === '')) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'note is required for resolve' } },
        { status: 400 },
      )
    }
    return NextResponse.json(
      await mutateStandaloneWarning(runtime, 'run', id, {
        op: body.op,
        rowId,
        note: body.note,
        expectedMtime: body.expectedMtime,
        expectedHash: body.expectedHash,
      }),
    )
  } catch (error) {
    return (
      standaloneWarningError(error) ??
      NextResponse.json({ error: { message: (error as Error).message } }, { status: 500 })
    )
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; rowId: string }> },
) {
  try {
    const runtime = await getRuntime()
    const { id, rowId } = await ctx.params
    const body = (await req.json().catch(() => ({}))) as {
      expectedMtime?: number
      expectedHash?: string
    }
    return NextResponse.json(
      await mutateStandaloneWarning(runtime, 'run', id, {
        op: 'delete',
        rowId,
        expectedMtime: body.expectedMtime,
        expectedHash: body.expectedHash,
      }),
    )
  } catch (error) {
    return (
      standaloneWarningError(error) ??
      NextResponse.json({ error: { message: (error as Error).message } }, { status: 500 })
    )
  }
}
