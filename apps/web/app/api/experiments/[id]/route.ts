import { BackendProjectServiceError } from '@memon/backend'
import { BackendExperimentResponseSchema } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import type { ExperimentDeleteResponse, ExperimentDocDetail } from '@/lib/dto/experiments'
import type { Wire } from '@/lib/dto/wire'
import { getRuntime } from '../../../../lib/server/runtime'
import { standaloneExperiment } from '../../../../lib/server/standalone-dto'
import { standaloneError } from '../../../../lib/server/standalone-error'
import {
  deleteStandaloneExperiment,
  standaloneExperimentMutationError,
} from '../../../../lib/server/standalone-experiment-mutation-route'
import { withStandaloneRequest } from '../../../../lib/server/standalone-request'
import { standaloneServices } from '../../../../lib/server/standalone-services'
import { standaloneExperimentTarget } from '../../../../lib/server/standalone-target'

export const dynamic = 'force-dynamic'

async function scopedGET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const runtime = await getRuntime()
  const { id } = await params
  let project: (typeof runtime.config.projects)[number]
  try {
    project = (
      await standaloneExperimentTarget(
        runtime.config,
        id,
        new URL(req.url).searchParams.get('project'),
      )
    ).project
  } catch (error) {
    return standaloneError(error)
  }
  try {
    const portable = BackendExperimentResponseSchema.parse(
      await standaloneServices(runtime.config).projects.getExperiment(project.name, id),
    )
    // The detail carries the Results summary and its newest input time.
    return NextResponse.json(
      standaloneExperiment(runtime.config, portable) satisfies Wire<ExperimentDocDetail>,
    )
  } catch (error) {
    if (error instanceof BackendProjectServiceError) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: error.message } },
        { status: 404 },
      )
    }
    return NextResponse.json({ error: { message: (error as Error).message } }, { status: 500 })
  }
}

async function scopedDELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const runtime = await getRuntime()
  const { id } = await params
  const force = new URL(req.url).searchParams.get('force') === 'true'
  try {
    return NextResponse.json(
      (await deleteStandaloneExperiment(runtime, id, force)) satisfies ExperimentDeleteResponse,
    )
  } catch (error) {
    return (
      standaloneExperimentMutationError(error) ??
      NextResponse.json({ error: { message: (error as Error).message } }, { status: 500 })
    )
  }
}

export const GET = withStandaloneRequest(scopedGET)
export const DELETE = withStandaloneRequest(scopedDELETE)
