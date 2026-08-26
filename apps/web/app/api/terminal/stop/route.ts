// POST /api/terminal/stop — shared singleton terminal lifecycle state.

import { BackendTerminalStopRequestSchema, BackendTerminalStopResponseSchema } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '../../../../lib/runtime'
import {
  standaloneTerminal,
  standaloneTerminalError,
} from '../../../../lib/server/standalone-terminal'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  let input: unknown
  try {
    input = await request.json()
  } catch {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'invalid JSON body' } },
      { status: 400 },
    )
  }
  const parsed = BackendTerminalStopRequestSchema.safeParse(input)
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'invalid stop request' } },
      { status: 400 },
    )
  }
  const service = standaloneTerminal((await getRuntime()).config)
  try {
    return NextResponse.json(
      BackendTerminalStopResponseSchema.parse(await service.stop(parsed.data)),
    )
  } catch (error) {
    return standaloneTerminalError(error)
  }
}
