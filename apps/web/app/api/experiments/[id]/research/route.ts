import { BackendResearchMutationRequestSchema, ProjectNameSchema } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '@/lib/server/runtime'
import { standaloneExperimentMutationError } from '@/lib/server/standalone-experiment-mutation-route'
import {
  refreshStandaloneExperiment,
  refreshStandaloneJournal,
} from '@/lib/server/standalone-mutation-refresh'
import { withStandaloneRequest } from '@/lib/server/standalone-request'
import { standaloneServices } from '@/lib/server/standalone-services'

export const dynamic = 'force-dynamic'
async function handle(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const projects = request.nextUrl.searchParams.getAll('project')
  const project = projects.length === 1 ? ProjectNameSchema.safeParse(projects[0]) : null
  if (!project?.success)
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Exactly one project is required' } },
      { status: 400 },
    )
  const runtime = await getRuntime()
  const { id } = await context.params
  const service = standaloneServices(runtime.config).mutations
  try {
    if (request.method === 'GET')
      return NextResponse.json(await service.getExperimentResearch(project.data, id))
    const input = BackendResearchMutationRequestSchema.safeParse(
      await request.json().catch(() => null),
    )
    if (!input.success)
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'Invalid research operation' } },
        { status: 400 },
      )
    const result = await service.mutateExperimentResearch(project.data, id, input.data)
    await Promise.all([
      refreshStandaloneExperiment(runtime, project.data, id),
      refreshStandaloneJournal(runtime, project.data),
    ])
    return NextResponse.json(result)
  } catch (error) {
    return (
      standaloneExperimentMutationError(error) ??
      NextResponse.json(
        { error: { code: 'RESEARCH_FAILED', message: (error as Error).message } },
        { status: 500 },
      )
    )
  }
}
export const GET = withStandaloneRequest(handle)
export const POST = withStandaloneRequest(handle)
