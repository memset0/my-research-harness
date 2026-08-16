// GET    /api/tmux-sessions/:name — enriched single-row lookup.
// DELETE /api/tmux-sessions/:name — kill a tmux session by name.
//
// Both verbs share the same name-shape validation. GET reuses the bulk-
// list helper's pane-info cache so per-button polls don't multiply tmux
// shell-outs. DELETE runs `tmux kill-session -t <name>` and clears any
// cached manager entry (the ttyd child exits naturally when its tmux
// client disconnects, but we send SIGTERM as a belt-and-braces).

import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '../../../../lib/runtime'

export const dynamic = 'force-dynamic'

const NAME_RE = /^memon-[A-Za-z0-9._-]+$/

export async function GET(_req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const rt = await getRuntime()
  if (rt.config.terminal?.tmuxEnabled === false) return tmuxDisabled()
  const { name: rawName } = await ctx.params
  const name = decodeURIComponent(rawName)

  if (!NAME_RE.test(name)) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: `name must match ${NAME_RE}` } },
      { status: 400 },
    )
  }

  const { getEnrichedSession } = await import('../../../../lib/terminal/tmux-discover')
  const row = await getEnrichedSession(rt, name)
  if (!row) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'tmux session not found' } },
      { status: 404 },
    )
  }
  return NextResponse.json({ row })
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const rt = await getRuntime()
  if (rt.config.terminal?.tmuxEnabled === false) return tmuxDisabled()
  const { name: rawName } = await ctx.params
  const name = decodeURIComponent(rawName)

  if (!name.startsWith('memon-')) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'name must start with memon-' } },
      { status: 400 },
    )
  }

  const { killTmuxSessionByName, tmuxHasSession } = await import(
    '../../../../lib/terminal/tmux-discover'
  )
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
    return NextResponse.json({ error: { message: (err as Error).message } }, { status: 500 })
  }
}

function tmuxDisabled() {
  return NextResponse.json(
    { error: { code: 'INTEGRATION_DISABLED', message: 'tmux integration is disabled' } },
    { status: 404 },
  )
}
