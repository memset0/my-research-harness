// GET /api/tmux-sessions — host-level inventory of `memon-*` tmux sessions.
// Used by /manage/tmux. Auth-gated via the Next middleware. See
// openspec/specs/tmux-session-management/.

import { NextResponse } from 'next/server'
import { getRuntime } from '../../../lib/runtime'
import { listMemonTmuxSessions } from '../../../lib/terminal/tmux-discover'

export const dynamic = 'force-dynamic'

export async function GET() {
  const rt = await getRuntime()
  const sessions = await listMemonTmuxSessions(rt)
  return NextResponse.json({ sessions })
}
