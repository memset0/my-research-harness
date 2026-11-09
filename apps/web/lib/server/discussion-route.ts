import 'server-only'
import {
  DiscussionError,
  DiscussionResponseInputSchema,
  DiscussionStatusInputSchema,
} from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import type { DiscussionDetail, DiscussionsResponse } from '../dto/discussions'
import { getRuntime } from './runtime'
import { standaloneError } from './standalone-error'
import { standaloneServices } from './standalone-services'

export async function discussionRoute(
  request: NextRequest,
  id?: string,
  action?: 'responses' | 'status',
) {
  try {
    const project = new URL(request.url).searchParams.get('project')
    if (!project || (id !== undefined && !/^D\d{4}$/.test(id)))
      throw new DiscussionError('BAD_REQUEST', 'Provide a Project and padded discussion ID')
    const rt = await getRuntime()
    const service = standaloneServices(rt.config).documents
    if (!id)
      return NextResponse.json(
        (await service.listDiscussions(project)) satisfies DiscussionsResponse,
      )
    if (!action)
      return NextResponse.json(
        (await service.getDiscussion(project, id)) satisfies DiscussionDetail,
      )
    const raw = await request.text()
    if (Buffer.byteLength(raw) > 8192)
      throw new DiscussionError('BAD_REQUEST', 'Discussion request is too large')
    const body = JSON.parse(raw)
    if (!body || typeof body !== 'object')
      throw new DiscussionError('BAD_REQUEST', 'Provide a JSON object')
    if (action === 'responses') {
      if (typeof body.question !== 'string' || typeof body.snapshot !== 'string' || !body.answer)
        throw new DiscussionError('BAD_REQUEST', 'Provide question, snapshot and answer')
      return NextResponse.json(
        await service.respondDiscussion(project, id, DiscussionResponseInputSchema.parse(body)),
      )
    }
    if (
      !['OPEN', 'CLOSED'].includes(body.status) ||
      typeof body.expectedMtime !== 'number' ||
      typeof body.expectedHash !== 'string'
    )
      throw new DiscussionError('BAD_REQUEST', 'Provide published status and document guards')
    return NextResponse.json(
      await service.setDiscussionStatus(project, id, DiscussionStatusInputSchema.parse(body)),
    )
  } catch (error) {
    if (error instanceof SyntaxError || (error instanceof Error && error.name === 'ZodError'))
      return standaloneError(new DiscussionError('BAD_REQUEST', 'Invalid discussion request'))
    return standaloneError(error)
  }
}
