import { BackendMutationError } from '@memon/backend'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { PatchArchiveResponse } from '@/lib/dto/runs'
import { getRuntime } from '../../../../../lib/server/runtime'
import {
  refreshStandaloneExperiment,
  refreshStandaloneJournal,
} from '../../../../../lib/server/standalone-mutation-refresh'
import { standaloneServices } from '../../../../../lib/server/standalone-services'

export const dynamic = 'force-dynamic'

const PatchBody = z.object({ archived: z.boolean(), expectedMtime: z.number().optional() }).strict()

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
    const { unchanged, ...result } = await standaloneServices(
      runtime.config,
    ).mutations.setExperimentArchived(project.name, id, body.data)
    if (!unchanged) {
      await Promise.all([
        refreshStandaloneExperiment(runtime, project.name, id),
        refreshStandaloneJournal(runtime, project.name),
      ])
    }
    return NextResponse.json({
      ...result,
      ...(unchanged ? { noop: true } : {}),
    } satisfies PatchArchiveResponse)
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
