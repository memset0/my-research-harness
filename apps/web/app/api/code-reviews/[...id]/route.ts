import {
  BackendCodeReviewPatchRequestSchema,
  BackendCodeReviewPatchResponseSchema,
  BackendCodeReviewResponseSchema,
  BackendDocumentConflictResponseSchema,
} from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '../../../../lib/runtime'
import { standaloneServices } from '../../../../lib/server/standalone-services'

export const dynamic = 'force-dynamic'

async function target(request: NextRequest, context: { params: Promise<{ id: string[] }> }) {
  const project = new URL(request.url).searchParams.get('project')
  const id = (await context.params).id.join('/')
  if (!project || !id) return null
  const runtime = await getRuntime()
  if (!runtime.config.projects.some((entry) => entry.name === project)) return null
  return { project, id, service: standaloneServices(runtime.config).documents }
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string[] }> }) {
  const resolved = await target(request, context)
  if (!resolved)
    return NextResponse.json({ error: { message: 'code-review not found' } }, { status: 404 })
  try {
    return NextResponse.json(
      BackendCodeReviewResponseSchema.parse(
        await resolved.service.getCodeReview(resolved.project, resolved.id),
      ),
    )
  } catch {
    return NextResponse.json({ error: { message: 'code-review not found' } }, { status: 404 })
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string[] }> }) {
  const resolved = await target(request, context)
  if (!resolved)
    return NextResponse.json({ error: { message: 'code-review not found' } }, { status: 404 })
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: { message: 'invalid JSON body' } }, { status: 400 })
  }
  const input = BackendCodeReviewPatchRequestSchema.safeParse(body)
  if (!input.success)
    return NextResponse.json({ error: { message: 'invalid patch request' } }, { status: 400 })
  try {
    const result = await resolved.service.patchCodeReview(resolved.project, resolved.id, input.data)
    const conflict = BackendDocumentConflictResponseSchema.safeParse(result)
    return conflict.success
      ? NextResponse.json(conflict.data, { status: 409 })
      : NextResponse.json(BackendCodeReviewPatchResponseSchema.parse(result))
  } catch {
    return NextResponse.json({ error: { message: 'code-review patch failed' } }, { status: 400 })
  }
}
