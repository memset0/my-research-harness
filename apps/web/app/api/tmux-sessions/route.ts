// GET|POST /api/tmux-sessions — standalone adapters over LocalBackendTerminalService.

import {
  BackendTmuxCreateRequestSchema,
  BackendTmuxCreateResponseSchema,
  BackendTmuxSessionsResponseSchema,
} from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '../../../lib/runtime'
import {
  standaloneTerminal,
  standaloneTerminalError,
} from '../../../lib/server/standalone-terminal'

export const dynamic = 'force-dynamic'

export async function GET() {
  const runtime = await getRuntime()
  if (!runtime.config.terminal.tmuxEnabled) return tmuxDisabled()
  const service = standaloneTerminal(runtime.config)
  try {
    const payload = BackendTmuxSessionsResponseSchema.parse(await service.listTmux())
    return NextResponse.json({
      sessions: payload.sessions.map(({ host: _host, ...session }) => session),
    })
  } catch (error) {
    return standaloneTerminalError(error)
  }
}

export async function POST(request: NextRequest) {
  const runtime = await getRuntime()
  if (!runtime.config.terminal.tmuxEnabled) return tmuxDisabled()
  let input: unknown
  try {
    input = await request.json()
  } catch {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'invalid JSON body' } },
      { status: 400 },
    )
  }
  const parsed = BackendTmuxCreateRequestSchema.safeParse(input)
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'invalid tmux create request' } },
      { status: 400 },
    )
  }
  const service = standaloneTerminal(runtime.config)
  try {
    const { host: _host, ...result } = BackendTmuxCreateResponseSchema.parse(
      await service.createTmux(parsed.data),
    )
    return NextResponse.json(result)
  } catch (error) {
    return standaloneTerminalError(error)
  }
}

function tmuxDisabled() {
  return NextResponse.json(
    { error: { code: 'INTEGRATION_DISABLED', message: 'tmux integration is disabled' } },
    { status: 404 },
  )
}
