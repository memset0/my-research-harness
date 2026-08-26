// GET|DELETE /api/tmux-sessions/:name — shared tmux service adapter.

import { BackendTmuxKillResponseSchema, BackendTmuxSessionResponseSchema } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '../../../../lib/runtime'
import {
  standaloneTerminal,
  standaloneTerminalError,
} from '../../../../lib/server/standalone-terminal'

export const dynamic = 'force-dynamic'

async function target(context: {
  params: Promise<{ name: string }>
}): Promise<
  | { ok: false; response: NextResponse }
  | { ok: true; name: string; service: ReturnType<typeof standaloneTerminal> }
> {
  const runtime = await getRuntime()
  if (!runtime.config.terminal.tmuxEnabled) return { ok: false, response: tmuxDisabled() }
  let name: string
  try {
    name = decodeURIComponent((await context.params).name)
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'invalid tmux session name' } },
        { status: 400 },
      ),
    }
  }
  return { ok: true, name, service: standaloneTerminal(runtime.config) }
}

export async function GET(_request: NextRequest, context: { params: Promise<{ name: string }> }) {
  const resolved = await target(context)
  if (!resolved.ok) return resolved.response
  try {
    const payload = BackendTmuxSessionResponseSchema.parse(
      await resolved.service.getTmux(resolved.name),
    )
    const { host: _host, ...row } = payload.row
    return NextResponse.json({ row })
  } catch (error) {
    return standaloneTerminalError(error)
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ name: string }> },
) {
  const resolved = await target(context)
  if (!resolved.ok) return resolved.response
  try {
    BackendTmuxKillResponseSchema.parse(await resolved.service.killTmux(resolved.name))
    return NextResponse.json({ ok: true })
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
