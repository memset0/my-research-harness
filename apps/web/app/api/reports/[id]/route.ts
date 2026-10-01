import {
  BackendDocumentConflictResponseSchema,
  BackendDocumentWriteRequestSchema,
  BackendDocumentWriteResponseSchema,
  BackendReportResponseSchema,
} from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '../../../../lib/server/runtime'
import { standaloneReport } from '../../../../lib/server/standalone-dto'
import { standaloneServices } from '../../../../lib/server/standalone-services'

export const dynamic = 'force-dynamic'

const ID = /^R\d{4}$/

async function target(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const project = new URL(request.url).searchParams.get('project')
  const id = (await context.params).id
  if (!project || !ID.test(id)) return null
  const runtime = await getRuntime()
  if (!runtime.config.projects.some((entry) => entry.name === project)) return null
  return { project, id, runtime, service: standaloneServices(runtime.config).documents }
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const resolved = await target(request, context)
  if (!resolved)
    return NextResponse.json({ error: { message: 'report not found' } }, { status: 404 })
  try {
    const report = BackendReportResponseSchema.parse(
      await resolved.service.getReport(resolved.project, resolved.id),
    )
    return NextResponse.json(standaloneReport(resolved.runtime.config, report))
  } catch {
    return NextResponse.json({ error: { message: 'report not found' } }, { status: 404 })
  }
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const resolved = await target(request, context)
  if (!resolved)
    return NextResponse.json({ error: { message: 'report not found' } }, { status: 404 })
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: { message: 'invalid JSON body' } }, { status: 400 })
  }
  const input = BackendDocumentWriteRequestSchema.safeParse(body)
  if (!input.success)
    return NextResponse.json({ error: { message: 'invalid write request' } }, { status: 400 })
  try {
    const result = await resolved.service.putReport(resolved.project, resolved.id, input.data)
    const conflict = BackendDocumentConflictResponseSchema.safeParse(result)
    if (conflict.success) {
      const current = BackendReportResponseSchema.parse(
        await resolved.service.getReport(resolved.project, resolved.id),
      )
      return NextResponse.json(
        { ...conflict.data, currentContent: current.content },
        { status: 409 },
      )
    }
    return NextResponse.json(BackendDocumentWriteResponseSchema.parse(result))
  } catch {
    return NextResponse.json({ error: { message: 'report write failed' } }, { status: 500 })
  }
}
