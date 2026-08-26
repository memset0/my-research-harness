// POST /api/tmux-sessions/:name/rename — shared tmux service adapter.

import { BackendTmuxRenameRequestSchema, BackendTmuxRenameResponseSchema } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '../../../../../lib/runtime'
import {
  standaloneTerminal,
  standaloneTerminalError,
} from '../../../../../lib/server/standalone-terminal'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, context: { params: Promise<{ name: string }> }) {
  const runtime = await getRuntime()
  if (!runtime.config.terminal.tmuxEnabled) {
    return NextResponse.json(
      { error: { code: 'INTEGRATION_DISABLED', message: 'tmux integration is disabled' } },
      { status: 404 },
    )
  }
  let oldName: string
  try {
    oldName = decodeURIComponent((await context.params).name)
  } catch {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'invalid tmux session name' } },
      { status: 400 },
    )
  }
  let input: unknown
  try {
    input = await request.json()
  } catch {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'invalid JSON body' } },
      { status: 400 },
    )
  }
  const parsed = BackendTmuxRenameRequestSchema.safeParse(input)
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'invalid tmux rename request' } },
      { status: 400 },
    )
  }
  const service = standaloneTerminal(runtime.config)
  try {
    const { host: _host, ...result } = BackendTmuxRenameResponseSchema.parse(
      await service.renameTmux(oldName, parsed.data),
    )
    return NextResponse.json(result)
  } catch (error) {
    return standaloneTerminalError(error)
  }
}
