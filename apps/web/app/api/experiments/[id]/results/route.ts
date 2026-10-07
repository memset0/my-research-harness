import { BackendProjectServiceError, BackendResultsError } from '@memon/backend'
import { BackendExperimentResultsResponseSchema, ProjectNameSchema } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import type { ExperimentResultsSnapshot, ResultsErrorResponsePayload } from '@/lib/dto/experiments'
import { getRuntime } from '../../../../../lib/server/runtime'
import { withStandaloneRequest } from '../../../../../lib/server/standalone-request'
import { standaloneServices } from '../../../../../lib/server/standalone-services'

export const dynamic = 'force-dynamic'

/**
 * The Results snapshot (standalone): the Experiment's generated Results
 * summary with every input fingerprint re-taken. A failed summary answers
 * with the status and body central returns: 400 `INVALID_RESULTS`, 404
 * `RESULTS_NOT_FOUND`, 422 `RESULT_SCHEMA_MISMATCH` / `RESULT_DUPLICATE_ROW`.
 */
async function scopedGET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    if (error instanceof BackendResultsError) {
      return NextResponse.json(error.body satisfies ResultsErrorResponsePayload, {
        status: error.status,
      })
    }
    if (error instanceof BackendProjectServiceError) {
      return NextResponse.json(
        {
          error: { code: 'RESULTS_NOT_FOUND', message: 'Experiment not found' },
          files: [],
          diagnostics: [],
          updatedAt: null,
        } satisfies ResultsErrorResponsePayload,
        { status: 404 },
      )
    }
    return NextResponse.json(
      { error: { code: 'RESULTS_READ_FAILED', message: 'the Results summary could not be read' } },
      { status: 500 },
    )
  }
}

export const GET = withStandaloneRequest(scopedGET)
