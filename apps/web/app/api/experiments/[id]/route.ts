import { BackendProjectServiceError } from '@memon/backend'
import { BackendExperimentResponseSchema } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import type { ExperimentDeleteResponse, ExperimentDocDetail } from '@/lib/dto/experiments'
import type { Wire } from '@/lib/dto/wire'
import { getRuntime } from '../../../../lib/server/runtime'
import { standaloneExperiment } from '../../../../lib/server/standalone-dto'
import {
  deleteStandaloneExperiment,
  standaloneExperimentMutationError,
} from '../../../../lib/server/standalone-experiment-mutation-route'
import { standaloneServices } from '../../../../lib/server/standalone-services'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const runtime = await getRuntime()
  const { id } = await params
  const cached = runtime.experiments.get(id)
  if (!cached) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: `experiment "${id}" not found` } },
      { status: 404 },
    )
  }
  const project = runtime.projectFor(cached.path)
  if (!project) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'owning project not found' } },
      { status: 404 },
    )
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

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
