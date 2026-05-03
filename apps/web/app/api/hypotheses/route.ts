// GET /api/hypotheses?project=NAME
//
// Returns the parsed HYPOTHESES.md for the given project. Reads exclusively
// from the runtime's HypothesesCache (populated at warmup; refreshed on
// mtime change via the shared Poller). No fs.readFile in the hot path.

import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '../../../lib/runtime'

export const dynamic = 'force-dynamic'

const EMPTY = {
  legendBlock: null,
  summaryTableBlock: null,
  entries: [],
  parseErrors: [],
  parseWarnings: [],
} as const

export async function GET(req: NextRequest) {
  try {
    const rt = await getRuntime()
    const url = new URL(req.url)
    const projectName = url.searchParams.get('project')
    if (!projectName) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'project query parameter is required' } },
        { status: 400 },
      )
    }
    const path = rt.hypothesesPath(projectName)
    if (!path) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: `project "${projectName}" not configured` } },
        { status: 404 },
      )
    }
    const entry = rt.hypothesesCache.get(path)
    if (!entry || entry.value === null) {
      return NextResponse.json({ path, ...EMPTY })
    }
    return NextResponse.json({ path, ...entry.value })
  } catch (err) {
    return NextResponse.json({ error: { message: (err as Error).message } }, { status: 500 })
  }
}
