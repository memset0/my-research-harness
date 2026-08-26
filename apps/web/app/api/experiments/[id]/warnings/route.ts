import { WARNING_CATEGORIES } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '../../../../../lib/runtime'
import {
  listStandaloneWarnings,
  mutateStandaloneWarning,
  standaloneWarningError,
} from '../../../../../lib/server/standalone-warning-route'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const runtime = await getRuntime()
    const { id } = await ctx.params
    return NextResponse.json({
      ok: true,
      ...(await listStandaloneWarnings(runtime, 'experiment', id)),
    })
  } catch (error) {
    return (
      standaloneWarningError(error) ??
      NextResponse.json({ error: { message: (error as Error).message } }, { status: 500 })
    )
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const runtime = await getRuntime()
    const { id } = await ctx.params
    const body = (await req.json()) as {
      category?: unknown
      message?: unknown
      run?: unknown
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
    if (body.run !== undefined && body.run !== null && typeof body.run !== 'string') {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'run must be a string, null, or omitted' } },
        { status: 400 },
      )
    }
    return NextResponse.json(
      await mutateStandaloneWarning(runtime, 'experiment', id, {
        op: 'add',
        category: body.category,
        message: body.message,
        run: body.run as string | null | undefined,
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
