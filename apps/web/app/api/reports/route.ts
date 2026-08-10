// GET /api/reports?project=NAME
//
// Returns the list of reports for a project — id, slug, path, mtime, title.
// Reads from the runtime's reportsCache (warmed at boot, refreshed by the
// shared Poller). The mtime stored on each summary comes from the cache's
// per-file dirent stat; we layer it on here from the cache state.

import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '../../../lib/runtime'
import { discoverReports } from '../../../lib/server/reports'

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
    const dir = rt.reportsDir(projectName)
    if (!dir) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: `project "${projectName}" not configured` } },
        { status: 404 },
      )
    }
    // Discover on request so directory bundles and their README changes are
    // visible alongside legacy standalone Markdown reports. The old
    // reportsCache intentionally remains file-only for backward compatibility.
    const reports = (await discoverReports(dir)).map(({ rootPath: _rootPath, ...summary }) => summary)
    return NextResponse.json({ reports })
  } catch (err) {
    return NextResponse.json({ error: { message: (err as Error).message } }, { status: 500 })
  }
}
