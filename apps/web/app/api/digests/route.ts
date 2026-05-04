// GET /api/digests?project=NAME
//
// Returns the list of digests for a project — id, date, path, mtime, title.
// Reads from the runtime's digestsCache. Sorted by date desc.

import { type NextRequest, NextResponse } from 'next/server'
import type { DigestSummary } from '@memon/core'
import { getRuntime } from '../../../lib/runtime'

export const dynamic = 'force-dynamic'

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
    const dir = rt.digestsDir(projectName)
    if (!dir) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: `project "${projectName}" not configured` } },
        { status: 404 },
      )
    }
    const digests: DigestSummary[] = rt.digestsCache.getList(dir).slice().sort((a, b) => {
      // Date descending (ISO YYYY-MM-DD sorts lexicographically).
      if (a.date > b.date) return -1
      if (a.date < b.date) return 1
      // Same date → compare id desc as a tiebreaker.
      if (a.id > b.id) return -1
      if (a.id < b.id) return 1
      return 0
    })
    return NextResponse.json({ digests })
  } catch (err) {
    return NextResponse.json({ error: { message: (err as Error).message } }, { status: 500 })
  }
}
