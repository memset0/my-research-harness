// GET /api/reports?project=NAME
//
// Returns the list of reports for a project — id, slug, path, mtime, title.
// Reads from the runtime's reportsCache (warmed at boot, refreshed by the
// shared Poller). The mtime stored on each summary comes from the cache's
// per-file dirent stat; we layer it on here from the cache state.

import { BackendReportsResponseSchema, BackendResourceInventoryResponseSchema } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import type { ReportsResponse } from '@/lib/dto/reports'
import { getRuntime } from '../../../lib/server/runtime'
import { standaloneReport } from '../../../lib/server/standalone-dto'
import { standaloneServices } from '../../../lib/server/standalone-services'

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
    if (!rt.config.projects.some((project) => project.name === projectName)) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: `project "${projectName}" not configured` } },
        { status: 404 },
      )
    }
    const inventoryOnly = url.searchParams.get('inventory') === '1'
    const result = await standaloneServices(rt.config).documents.listReports(projectName, {
      inventoryOnly,
    })
    if (inventoryOnly) {
      return NextResponse.json(BackendResourceInventoryResponseSchema.parse(result))
    }
    // Discover on request so directory bundles and their README changes are
    // visible alongside legacy standalone Markdown reports. The old
    // reportsCache intentionally remains file-only for backward compatibility.
    const reports = BackendReportsResponseSchema.parse(result).reports.map((report) =>
      standaloneReport(rt.config, report),
    )
    return NextResponse.json({ reports } satisfies ReportsResponse)
  } catch (err) {
    return NextResponse.json({ error: { message: (err as Error).message } }, { status: 500 })
  }
}
