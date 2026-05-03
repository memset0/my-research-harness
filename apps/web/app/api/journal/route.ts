// GET /api/journal?project=NAME[&limit=N&before=ISO]
//
// Returns parsed JOURNAL.md events newest-first, optionally limited.

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { type NextRequest, NextResponse } from 'next/server'
import { parseJournal } from '@memon/core'
import { getRuntime } from '../../../lib/runtime'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const rt = await getRuntime()
    const url = new URL(req.url)
    const projectName = url.searchParams.get('project')
    const limitStr = url.searchParams.get('limit')
    const before = url.searchParams.get('before')

    if (!projectName) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'project query parameter is required' } },
        { status: 400 },
      )
    }
    const project = rt.config.projects.find((p) => p.name === projectName)
    if (!project) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: `project "${projectName}" not configured` } },
        { status: 404 },
      )
    }
    const path = join(project.root, 'JOURNAL.md')
    let content: string
    try {
      content = await fs.readFile(path, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return NextResponse.json({ path, lastDigestAt: null, events: [] })
      }
      throw err
    }
    const parsed = parseJournal(content)
    let events = [...parsed.events].reverse() // newest-first
    if (before) events = events.filter((e) => e.timestamp < before)
    const limit = limitStr ? Math.max(0, Number.parseInt(limitStr, 10) || 0) : Number.POSITIVE_INFINITY
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
