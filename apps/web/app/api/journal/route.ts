// GET /api/journal?project=NAME[&limit=N&before=ISO]
//
// Returns parsed docs/journal.md events newest-first, optionally limited.
// Reads from the runtime's JournalCache (no fs.readFile in the hot path).
//
// Special-case: `?countOnly=1` short-circuits and returns just the total
// event count (and lastDigestAt) without serializing the events array. Used
// by the AppBar count badge so it always shows the project total regardless
// of any default page-limit applied by the journal view.

import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '../../../lib/runtime'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const rt = await getRuntime()
    const url = new URL(req.url)
    const projectName = url.searchParams.get('project')
    const countOnly = url.searchParams.get('countOnly') === '1'
    const limitStr = url.searchParams.get('limit')
    const before = url.searchParams.get('before')

    if (!projectName) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'project query parameter is required' } },
        { status: 400 },
      )
    }
    const path = rt.journalPath(projectName)
    if (!path) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: `project "${projectName}" not configured` } },
        { status: 404 },
      )
    }

    const entry = rt.journalCache.get(path)
    if (!entry || entry.value === null) {
      if (countOnly) {
        return NextResponse.json({ totalEvents: 0, lastDigestAt: null })
      }
      return NextResponse.json({
        path,
        lastDigestAt: null,
        events: [],
        parseErrors: [],
        parseWarnings: [],
      })
    }
    const parsed = entry.value
    if (countOnly) {
      return NextResponse.json({
        totalEvents: parsed.events.length,
        lastDigestAt: parsed.lastDigestAt,
      })
    }
    let events = [...parsed.events].reverse() // newest-first
    if (before) events = events.filter((e) => e.timestamp < before)
    const limit = limitStr
      ? Math.max(0, Number.parseInt(limitStr, 10) || 0)
      : Number.POSITIVE_INFINITY
    if (Number.isFinite(limit)) events = events.slice(0, limit)
    return NextResponse.json({
      path,
      lastDigestAt: parsed.lastDigestAt,
      events,
      parseErrors: parsed.parseErrors,
      parseWarnings: parsed.parseWarnings,
    })
  } catch (err) {
    return NextResponse.json({ error: { message: (err as Error).message } }, { status: 500 })
  }
}
