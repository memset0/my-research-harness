import { WARNING_CATEGORIES } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import type { WarningsConflict, WarningsListResponse, WarningsOpResponse } from '@/lib/dto/warnings'
import { withValidRunId } from '../../../../../lib/server/run-id'
import { getRuntime } from '../../../../../lib/server/runtime'
import {
  listStandaloneWarnings,
  mutateStandaloneWarning,
  standaloneWarningError,
} from '../../../../../lib/server/standalone-warning-route'

export const dynamic = 'force-dynamic'

async function handleGET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const runtime = await getRuntime()
    const { id } = await ctx.params
    return NextResponse.json({
      ok: true,
      ...(await listStandaloneWarnings(runtime, 'run', id)),
    } satisfies WarningsListResponse)
  } catch (error) {
    return (
      standaloneWarningError(error) ??
      NextResponse.json({ error: { message: (error as Error).message } }, { status: 500 })
    )
  }
}

async function handlePOST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const runtime = await getRuntime()
    const { id } = await ctx.params
    const body = (await req.json()) as {
      category?: unknown
      message?: unknown
      expectedMtime?: number
      expectedHash?: string
    }
    if (typeof body?.category !== 'string' || typeof body.message !== 'string') {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'category and message are required' } },
        { status: 400 },
      )
    }
    if (!(WARNING_CATEGORIES as readonly string[]).includes(body.category)) {
      return NextResponse.json(
        {
          error: {
            code: 'BAD_REQUEST',
            message: `category must be one of: ${WARNING_CATEGORIES.join(', ')}`,
          },
        },
        { status: 400 },
      )
    }
    return NextResponse.json(
      (await mutateStandaloneWarning(runtime, 'run', id, {
        op: 'add',
        category: body.category,
        message: body.message,
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

export const GET = withValidRunId(handleGET)
export const POST = withValidRunId(handlePOST)
