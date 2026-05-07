// GET /api/terminal/list — currently active ttyd entries in the manager.
// Returns one row per (agent, project, scope, slug) the manager holds.
// The /manage/tmux page uses GET /api/tmux-sessions for the broader
// host-level tmux inventory; this endpoint is for in-process state only.

import { NextResponse } from 'next/server'
import { listSessions } from '../../../../lib/terminal/manager'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ sessions: listSessions() })
}
