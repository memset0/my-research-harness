import { BackendMutationError } from '@memon/backend'
import {
  BackendExperimentResponseSchema,
  BackendReadmeResponseSchema,
  BackendRunResponseSchema,
  ProjectNameSchema,
} from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '../runtime'
import {
  refreshStandaloneExperiment,
  refreshStandaloneJournal,
  refreshStandaloneRun,
} from './standalone-mutation-refresh'
import { standaloneServices } from './standalone-services'

export async function readStandaloneReadme(
  kind: 'run' | 'experiment',
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const target = await resolveTarget(kind, request, context)
  if (target instanceof NextResponse) return target
  try {
    const readme = BackendReadmeResponseSchema.parse(
      await target.services.documents.getReadme(target.project, target.resource),
    )
    return NextResponse.json({
      resource: readme.resource,
      content: readme.content,
      mtime: readme.mtime,
      hash: readme.hash,
    })
  } catch {
    return notFound(kind)
  }
}

export async function writeStandaloneReadme(
  kind: 'run' | 'experiment',
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const target = await resolveTarget(kind, request, context)
  if (target instanceof NextResponse) return target
  let body: { content?: unknown; expectedMtime?: unknown; expectedHash?: unknown }
  try {
    body = await request.json()
  } catch {
    return badRequest('invalid JSON body')
  }
  if (typeof body.content !== 'string' || typeof body.expectedMtime !== 'number') {
    return badRequest('content and expectedMtime are required')
  }
  try {
    const current = BackendReadmeResponseSchema.parse(
      await target.services.documents.getReadme(target.project, target.resource),
    )
    const input = {
      content: body.content,
      expectedMtime: body.expectedMtime,
      expectedHash: typeof body.expectedHash === 'string' ? body.expectedHash : current.hash,
    }
    const result =
      kind === 'run'
        ? await target.services.mutations.writeRunReadme(target.project, target.id, input)
        : await target.services.mutations.writeExperimentReadme(target.project, target.id, input)
    if (kind === 'run') await refreshStandaloneRun(target.runtime, target.project, target.id)
    else await refreshStandaloneExperiment(target.runtime, target.project, target.id)
    if (result.journalChanged) await refreshStandaloneJournal(target.runtime, target.project)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof BackendMutationError && error.code === 'CONFLICT') {
      return NextResponse.json(
        {
          error: { code: 'CONFLICT', message: error.message },
          mtime: error.current?.mtime,
          content: error.current?.content,
        },
        { status: 409 },
      )
    }
    if (error instanceof BackendMutationError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.code === 'FORBIDDEN' ? 403 : 404 },
      )
    }
    return NextResponse.json({ error: { message: 'README write failed' } }, { status: 500 })
  }
}

async function resolveTarget(
  kind: 'run' | 'experiment',
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const values = new URL(request.url).searchParams.getAll('project')
  if (values.length > 1) return badRequest('project selector is ambiguous')
  const id = (await context.params).id
  const runtime = await getRuntime()
  const services = standaloneServices(runtime.config)
  const selected = values.length === 1 ? ProjectNameSchema.safeParse(values[0]) : null
  if (selected && !selected.success) return badRequest('project selector is invalid')
  const candidates = selected?.success
    ? runtime.config.projects.filter((project) => project.name === selected.data)
    : runtime.config.projects
  for (const candidate of candidates) {
    try {
      const resource =
        kind === 'run'
          ? BackendRunResponseSchema.parse(await services.projects.getRun(candidate.name, id))
              .resource
          : BackendExperimentResponseSchema.parse(
              await services.projects.getExperiment(candidate.name, id),
            ).resource
      return { runtime, services, project: candidate.name, id, resource }
    } catch {
      // Try the next configured standalone Project; central always supplies one.
    }
  }
  return notFound(kind)
}

function badRequest(message: string) {
  return NextResponse.json({ error: { code: 'BAD_REQUEST', message } }, { status: 400 })
}

function notFound(kind: 'run' | 'experiment') {
  return NextResponse.json(
    { error: { code: 'NOT_FOUND', message: `${kind} README not found` } },
    { status: 404 },
  )
}
