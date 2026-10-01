import { BackendProjectServiceError } from '@memon/backend'
import { BackendExperimentResultsResponseSchema, ProjectNameSchema } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import type { ExperimentResultsSnapshot } from '@/lib/dto/experiments'
import { getRuntime } from '../../../../../lib/server/runtime'
import { standaloneServices } from '../../../../../lib/server/standalone-services'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const runtime = await getRuntime()
  const { id } = await params
  const projects = new URL(request.url).searchParams.getAll('project')
  const project = projects.length === 1 ? ProjectNameSchema.safeParse(projects[0]) : null
  if (!project?.success) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'exactly one project selector is required' } },
      { status: 400 },
    )
  }
  try {
    return NextResponse.json(
      BackendExperimentResultsResponseSchema.parse(
        await standaloneServices(runtime.config).projects.getExperimentResults(project.data, id),
      ) satisfies ExperimentResultsSnapshot,
    )
  } catch (error) {
    if (error instanceof BackendProjectServiceError) {
      if (error.code === 'INVALID_RESOURCE') {
        const details = error.details ?? {}
        return NextResponse.json(
          {
            error: {
              code: 'INVALID_RESULTS',
              message:
                (details.diagnostics as Array<{ message?: string }> | undefined)?.[0]?.message ??
                'results.yaml is invalid',
            },
            diagnostics: details.diagnostics ?? [],
            updatedAt: details.updatedAt ?? null,
          },
          { status: 422 },
        )
      }
      return NextResponse.json(
        { error: { code: 'RESULTS_NOT_FOUND', message: 'results.yaml does not exist' } },
        { status: 404 },
      )
    }
    return NextResponse.json(
      { error: { code: 'RESULTS_READ_FAILED', message: 'results.yaml could not be read' } },
      { status: 500 },
    )
  }
}
