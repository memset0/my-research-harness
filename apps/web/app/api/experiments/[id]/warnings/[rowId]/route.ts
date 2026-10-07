import { type NextRequest, NextResponse } from 'next/server'
import type { WarningsConflict, WarningsOpResponse } from '@/lib/dto/warnings'
import { getRuntime } from '../../../../../../lib/server/runtime'
import { withStandaloneRequest } from '../../../../../../lib/server/standalone-request'
import {
  mutateStandaloneWarning,
  standaloneWarningError,
} from '../../../../../../lib/server/standalone-warning-route'

export const dynamic = 'force-dynamic'

async function scopedPATCH(
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
      (await mutateStandaloneWarning(runtime, 'experiment', id, {
        op: body.op,
        rowId,
        note: body.note,
        expectedMtime: body.expectedMtime,
        expectedHash: body.expectedHash,
      })) satisfies WarningsOpResponse | WarningsConflict,
    )
  } catch (error) {
    return (
      standaloneWarningError(error) ??
      NextResponse.json({ error: { message: (error as Error).message } }, { status: 500 })
    )
  }
}

async function scopedDELETE(
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
      (await mutateStandaloneWarning(runtime, 'experiment', id, {
        op: 'delete',
        rowId,
        expectedMtime: body.expectedMtime,
        expectedHash: body.expectedHash,
      })) satisfies WarningsOpResponse | WarningsConflict,
    )
  } catch (error) {
    return (
      standaloneWarningError(error) ??
      NextResponse.json({ error: { message: (error as Error).message } }, { status: 500 })
    )
  }
}

export const PATCH = withStandaloneRequest(scopedPATCH)
export const DELETE = withStandaloneRequest(scopedDELETE)
