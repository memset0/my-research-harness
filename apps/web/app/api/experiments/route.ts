import { BackendProjectServiceError } from '@memon/backend'
import {
  BackendExperimentsResponseSchema,
  BackendResourceInventoryResponseSchema,
} from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import type { ExperimentCreateResponse, ExperimentDocsResponse } from '@/lib/dto/experiments'
import type { Wire } from '@/lib/dto/wire'
import { getRuntime } from '../../../lib/server/runtime'
import { standaloneExperiment } from '../../../lib/server/standalone-dto'
import {
  createStandaloneExperiment,
  standaloneExperimentMutationError,
} from '../../../lib/server/standalone-experiment-mutation-route'
import { standaloneServices } from '../../../lib/server/standalone-services'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const runtime = await getRuntime()
  const search = new URL(req.url).searchParams
  const projectFilter = search.get('project')
  const projects = projectFilter
    ? runtime.config.projects.filter((project) => project.name === projectFilter)
    : runtime.config.projects
  try {
    const inventoryOnly = search.get('inventory') === '1'
    const responses = await Promise.all(
      projects.map((project) =>
        standaloneServices(runtime.config).projects.listExperiments(project.name, {
          inventoryOnly,
        }),
      ),
    )
    if (inventoryOnly) {
      return NextResponse.json({
        items: responses.flatMap(
          (response) => BackendResourceInventoryResponseSchema.parse(response).items,
        ),
      })
    }
    const experiments = responses.flatMap(
      (response) => BackendExperimentsResponseSchema.parse(response).experiments,
    )
    return NextResponse.json({
      experiments: experiments.map((experiment) =>
        standaloneExperiment(runtime.config, experiment),
      ),
    } satisfies Wire<ExperimentDocsResponse>)
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

interface PostBody {
  project?: string
  slug: string
  title?: string
  hypotheses?: string[]
  tags?: string[]
  fromRun?: string | null
}

export async function POST(req: NextRequest) {
  const runtime = await getRuntime()
  const body = (await req.json().catch(() => null)) as PostBody | null
  if (!body || typeof body.slug !== 'string') {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'slug is required' } },
      { status: 400 },
    )
  }
  const project =
    body.project ?? (runtime.config.projects.length === 1 ? runtime.config.projects[0]!.name : null)
  if (!project) {
    return NextResponse.json(
      {
        error: {
          code: 'BAD_REQUEST',
          message: 'project is required when multiple projects are configured',
        },
      },
      { status: 400 },
    )
  }
  try {
    return NextResponse.json({
      ok: true,
      ...(await createStandaloneExperiment(runtime, project, {
        slug: body.slug,
        title: body.title,
        hypotheses: body.hypotheses,
        tags: body.tags,
        fromRun: body.fromRun ?? null,
      })),
    } satisfies ExperimentCreateResponse)
  } catch (error) {
    return (
      standaloneExperimentMutationError(error) ??
      NextResponse.json({ error: { message: (error as Error).message } }, { status: 500 })
    )
  }
}
