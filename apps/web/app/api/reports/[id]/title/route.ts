// POST /api/reports/[id]/title?project=NAME  { "title": "…" }
//
// Owner-only rename of a Report's display title. Only the title bytes of the
// document (and its catalog entry) change; a read-only Project needs
// `allowed_edits: [title]`.

import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '../../../../../lib/server/runtime'
import { standaloneError } from '../../../../../lib/server/standalone-error'
import { withStandaloneRequest } from '../../../../../lib/server/standalone-request'
import { standaloneServices } from '../../../../../lib/server/standalone-services'

export const dynamic = 'force-dynamic'

const ID = /^R\d{4}$/

async function scopedPOST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const project = new URL(request.url).searchParams.get('project')
  const id = (await context.params).id
  const runtime = await getRuntime()
  if (!project || !ID.test(id) || !runtime.config.projects.some((entry) => entry.name === project))
    return NextResponse.json({ error: { message: 'report not found' } }, { status: 404 })
  const body = (await request.json().catch(() => null)) as { title?: unknown } | null
  try {
    const report = await standaloneServices(runtime.config).documents.setReportTitle(project, id, {
      title: body?.title,
    })
    return NextResponse.json({ ok: true, title: report.title })
  } catch (error) {
    return standaloneError(error)
  }
}

export const POST = withStandaloneRequest(scopedPOST)
