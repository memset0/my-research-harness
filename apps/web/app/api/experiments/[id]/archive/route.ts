import { BackendMutationError } from '@memon/backend'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { PatchArchiveResponse } from '@/lib/dto/runs'
import { getRuntime } from '../../../../../lib/server/runtime'
import { standaloneError } from '../../../../../lib/server/standalone-error'
import {
  refreshStandaloneExperiment,
  refreshStandaloneJournal,
} from '../../../../../lib/server/standalone-mutation-refresh'
import { withStandaloneRequest } from '../../../../../lib/server/standalone-request'
import { standaloneServices } from '../../../../../lib/server/standalone-services'
import { standaloneExperimentTarget } from '../../../../../lib/server/standalone-target'

export const dynamic = 'force-dynamic'

const PatchBody = z.object({ archived: z.boolean(), expectedMtime: z.number().optional() }).strict()

async function scopedPATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const runtime = await getRuntime()
  const { id } = await ctx.params
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

export const PATCH = withStandaloneRequest(scopedPATCH)
