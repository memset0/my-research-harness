import { join } from 'node:path'
import { BackendJournalResponseSchema } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '../../../lib/runtime'
import { standaloneServices } from '../../../lib/server/standalone-services'

export const dynamic = 'force-dynamic'

/**
 * Legacy `docs/journal.md` read. memon never appends to that file any more, so
 * this route is pure preserved history: no cursor is projected and no
 * invocation receipt is exposed here. Merged owner diagnostics live at
 * `/api/journal/history`.
 */
export async function GET(request: NextRequest) {
  const runtime = await getRuntime()
  const search = new URL(request.url).searchParams
  const project = search.get('project')
  const entry = runtime.config.projects.find((candidate) => candidate.name === project)
  if (!project || !entry)
    return NextResponse.json({ error: { message: 'project not found' } }, { status: 404 })
  try {
    const result = BackendJournalResponseSchema.parse(
      await standaloneServices(runtime.config).projects.getJournal(project),
    )
    if (search.get('countOnly') === '1') {
      return NextResponse.json({ totalEvents: result.events.length })
    }
    const before = search.get('before')
    const limit = Number(search.get('limit') ?? Number.POSITIVE_INFINITY)
    const events = (
      before ? result.events.filter((event) => event.timestamp < before) : result.events
    ).slice(0, Number.isFinite(limit) ? Math.max(0, limit) : undefined)
    return NextResponse.json({
      path: join(entry.root, 'docs', 'journal.md'),
      ...result,
      events,
    })
  } catch {
    return NextResponse.json({ error: { message: 'journal read failed' } }, { status: 500 })
  }
}
