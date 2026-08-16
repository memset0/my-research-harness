// GET /api/tmux-sessions  — host-level inventory of `memon-*` tmux sessions.
// POST /api/tmux-sessions — create a manually-named tmux session.
//
// Both auth-gated via the Next middleware. See
// openspec/specs/tmux-session-management/.

import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getRuntime } from '../../../lib/runtime'

export const dynamic = 'force-dynamic'

export async function GET() {
  const rt = await getRuntime()
  if (rt.config.terminal?.tmuxEnabled === false) return tmuxDisabled()
  const { listMemonTmuxSessions } = await import('../../../lib/terminal/tmux-discover')
  const sessions = await listMemonTmuxSessions(rt)
  return NextResponse.json({ sessions })
}

const PostBodySchema = z.object({
  name: z.string().min(1),
})

export async function POST(req: NextRequest) {
  const rt = await getRuntime()
  if (rt.config.terminal?.tmuxEnabled === false) return tmuxDisabled()
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'invalid JSON body' } },
      { status: 400 },
    )
  }
  const parsed = PostBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'BAD_REQUEST',
          message: parsed.error.issues.map((i) => i.message).join('; '),
        },
      },
      { status: 400 },
    )
  }

  try {
    const { createManualTmuxSession } = await import('../../../lib/terminal/tmux-discover')
    const result = await createManualTmuxSession({ name: parsed.data.name })
    return NextResponse.json({
      ok: true,
      sessionName: result.sessionName,
      alreadyExisted: result.alreadyExisted,
    })
  } catch (err) {
    const msg = (err as Error).message
    // Validation errors from createManualTmuxSession surface as plain
    // Error objects; treat them as 400. Anything else (tmux exec failure)
    // is 500.
    const isValidation = msg.startsWith('name ') || msg.includes('memon-') || msg.includes('--')
    return NextResponse.json(
      { error: { code: isValidation ? 'BAD_REQUEST' : 'INTERNAL', message: msg } },
      { status: isValidation ? 400 : 500 },
    )
  }
}

function tmuxDisabled() {
  return NextResponse.json(
    { error: { code: 'INTEGRATION_DISABLED', message: 'tmux integration is disabled' } },
    { status: 404 },
  )
}
