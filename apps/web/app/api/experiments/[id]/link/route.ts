import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '../../../../../lib/server/runtime'
import {
  bindStandaloneExperiment,
  standaloneExperimentMutationError,
} from '../../../../../lib/server/standalone-experiment-mutation-route'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const body = (await req.json().catch(() => null)) as { run?: unknown } | null
  if (typeof body?.run !== 'string' || body.run === '') {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'run is required' } },
      { status: 400 },
    )
  }
  try {
    const runtime = await getRuntime()
    const { id } = await ctx.params
    return NextResponse.json({
      ok: true,
      ...(await bindStandaloneExperiment(runtime, 'link', id, body.run)),
    })
  } catch (error) {
    return (
      standaloneExperimentMutationError(error) ??
      NextResponse.json({ error: { message: (error as Error).message } }, { status: 500 })
    )
  }
}
