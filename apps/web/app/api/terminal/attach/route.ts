// POST /api/terminal/attach — shared singleton terminal lifecycle state.

import { BackendTerminalAttachRequestSchema } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '../../../../lib/runtime'
import {
  standaloneTerminal,
  standaloneTerminalError,
  standaloneTerminalSession,
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
  const parsed = BackendTerminalAttachRequestSchema.safeParse(input)
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'invalid attach request' } },
      { status: 400 },
    )
  }
  const runtime = await getRuntime()
  if (!runtime.config.terminal.tmuxEnabled) {
    return NextResponse.json(
      { error: { code: 'INTEGRATION_DISABLED', message: 'tmux integration is disabled' } },
      { status: 404 },
    )
  }
  const service = standaloneTerminal(runtime.config)
  try {
    return NextResponse.json(standaloneTerminalSession(service, await service.attach(parsed.data)))
  } catch (error) {
    return standaloneTerminalError(error)
  }
}
