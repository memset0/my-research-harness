import { BackendMutationError } from '@memon/backend'
import { EXPERIMENT_STATUS_VALUES, type ExperimentStatus } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getRuntime } from '../../../../../lib/server/runtime'
import {
  refreshStandaloneExperiment,
  refreshStandaloneJournal,
} from '../../../../../lib/server/standalone-mutation-refresh'
import { standaloneServices } from '../../../../../lib/server/standalone-services'

export const dynamic = 'force-dynamic'

const PatchBody = z
  .object({
    status: z.enum(EXPERIMENT_STATUS_VALUES as readonly [ExperimentStatus, ...ExperimentStatus[]]),
    expectedMtime: z.number(),
  })
  .strict()

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const runtime = await getRuntime()
  const { id } = await ctx.params
  const experiment = runtime.experiments.get(id)
  if (!experiment) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: `experiment "${id}" not found` } },
      { status: 404 },
    )
  }
  const project = runtime.projectFor(experiment.path)
  if (!project) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'owning project not found' } },
      { status: 404 },
    )
  }
  const body = PatchBody.safeParse(await req.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json(
      {
        error: {
          code: 'BAD_REQUEST',
          message: body.error.issues
            .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
            .join('; '),
        },
      },
      { status: 400 },
    )
  }
  try {
    const { ok: _ok, ...result } = await standaloneServices(
      runtime.config,
    ).mutations.setExperimentStatus(project.name, id, body.data)
    if (!result.unchanged) {
      await Promise.all([
        refreshStandaloneExperiment(runtime, project.name, id),
        refreshStandaloneJournal(runtime, project.name),
      ])
    }
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof BackendMutationError) {
      if (error.code === 'CONFLICT') {
        return NextResponse.json(
          {
            error: { code: 'CONFLICT', message: error.message },
            mtime: error.current?.mtime,
            content: error.current?.content,
          },
          { status: 409 },
        )
      }
      if (error.code === 'RESOURCE_NOT_FOUND' || error.code === 'PROJECT_NOT_FOUND') {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: error.message } },
          { status: 404 },
        )
      }
    }
    return NextResponse.json({ error: { message: (error as Error).message } }, { status: 500 })
  }
}
