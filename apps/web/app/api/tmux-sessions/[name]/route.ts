// DELETE /api/tmux-sessions/:name — kill a tmux session by name.
//
// Validates the name shape, runs `tmux kill-session -t <name>`, and clears
// any cached manager entry (the ttyd child exits naturally when its tmux
// client disconnects, but we send SIGTERM as a belt-and-braces).

import { type NextRequest, NextResponse } from 'next/server'
import {
  killTmuxSessionByName,
  tmuxHasSession,
} from '../../../../lib/terminal/tmux-discover'

export const dynamic = 'force-dynamic'

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ name: string }> },
) {
  const { name: rawName } = await ctx.params
  const name = decodeURIComponent(rawName)

  if (!name.startsWith('memon-')) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'name must start with memon-' } },
      { status: 400 },
    )
  }

  if (!(await tmuxHasSession(name))) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'tmux session not found' } },
      { status: 404 },
    )
  }

  try {
    await killTmuxSessionByName(name)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { error: { message: (err as Error).message } },
      { status: 500 },
    )
  }
}
