import { BackendProjectServiceError, withRequestScope } from '@memon/backend'
import { NextResponse } from 'next/server'
import type { FullExperiment } from '@/lib/dto/runs'
import type { Wire } from '@/lib/dto/wire'
import { withValidRunId } from '../../../../lib/server/run-id'
import { getRuntime } from '../../../../lib/server/runtime'
import { standaloneRun } from '../../../../lib/server/standalone-dto'
import { withStandaloneRequest } from '../../../../lib/server/standalone-request'
import { standaloneRunTarget } from '../../../../lib/server/standalone-target'

export const dynamic = 'force-dynamic'

async function handleGET(request: Request, context: { params: Promise<{ id: string }> }) {
  const runtime = await getRuntime()
  const id = (await context.params).id
  const requestedProject = new URL(request.url).searchParams.get('project')
  try {
    const { value: run } = await standaloneRunTarget(runtime.config, id, requestedProject)
    return NextResponse.json(standaloneRun(runtime.config, run) satisfies Wire<FullExperiment>)
  } catch (error) {
    if (error instanceof BackendProjectServiceError)
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.code === 'INVALID_RESOURCE' ? 400 : 404 },
      )
    throw error
  }
}

// One request scope: the Project root's real path is resolved once.
const scopedGET = withValidRunId(
  (request: Parameters<typeof handleGET>[0], context: Parameters<typeof handleGET>[1]) =>
    withRequestScope(() => handleGET(request, context)),
)

export const GET = withStandaloneRequest(scopedGET)
