import { promises as fs } from 'node:fs'
import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '../../../../../../lib/runtime'
import {
  findReport,
  ReportResourceError,
  resolveReportResource,
} from '../../../../../../lib/server/reports'

export const dynamic = 'force-dynamic'

const ID_RE = /^R\d{4}$/

/**
 * Serve files belonging to a directory-style Report. The project is a path
 * segment (rather than a query parameter) so HTML loaded in an iframe can use
 * ordinary relative fetches such as `fetch('./data/metrics.json')`.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ project: string; id: string; path: string[] | string }> },
) {
  try {
    const { project: rawProject, id: rawId, path } = await params
    const project = safeDecode(rawProject)
    const id = safeDecode(rawId)
    // Next supplies a string[]; the headless node dispatcher represents a
    // catch-all as a slash-joined string. Supporting both keeps the same
    // route handler usable in either runtime.
    const pathSegments = (Array.isArray(path) ? path : path.split('/')).map(safeDecode)
    if (!ID_RE.test(id)) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: `invalid report id "${id}"` } },
        { status: 400 },
      )
    }

    const rt = await getRuntime()
    const reportsDir = rt.reportsDir(project)
    if (!reportsDir) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: `project "${project}" not configured` } },
        { status: 404 },
      )
    }
    const report = await findReport(reportsDir, id)
    if (!report || report.format !== 'bundle') {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: `report bundle "${id}" not found` } },
        { status: 404 },
      )
    }

    const resource = await resolveReportResource(report, pathSegments)
    const bytes = await fs.readFile(resource.path)
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': resource.contentType,
        'Cache-Control': 'private, no-cache',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (err) {
    if (err instanceof ReportResourceError) {
      const status = err.code === 'BAD_PATH' ? 400 : err.code === 'OUTSIDE_REPORT' ? 403 : 404
      return NextResponse.json({ error: { code: err.code, message: err.message } }, { status })
    }
    return NextResponse.json({ error: { message: (err as Error).message } }, { status: 500 })
  }
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}
