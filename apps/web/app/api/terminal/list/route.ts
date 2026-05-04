// GET /api/terminal/list — currently active ttyd sessions (v1: ≤1).

import { NextResponse } from 'next/server'
import { listSessions } from '../../../../lib/terminal/manager'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ sessions: listSessions() })
}
