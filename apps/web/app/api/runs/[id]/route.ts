import { BackendProjectServiceError } from '@memon/backend'
import { BackendRunResponseSchema } from '@memon/core'
import { NextResponse } from 'next/server'
import type { FullExperiment } from '@/lib/dto/runs'
import type { Wire } from '@/lib/dto/wire'
import { getRuntime } from '../../../../lib/server/runtime'
import { standaloneRun } from '../../../../lib/server/standalone-dto'
import { standaloneServices } from '../../../../lib/server/standalone-services'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const runtime = await getRuntime()
  const id = (await context.params).id
  const requestedProject = new URL(request.url).searchParams.get('project')
  const services = standaloneServices(runtime.config)
  const projects = requestedProject
    ? runtime.config.projects.filter((project) => project.name === requestedProject)
    : runtime.config.projects
  for (const project of projects) {
    // An explicit id resolves directly, including deprecated/archived Runs.
    // An existence check must not load every other Run's metadata first.
    try {
      const run = BackendRunResponseSchema.parse(await services.projects.getRun(project.name, id))
      runtime.pokeById(id)
      return NextResponse.json(standaloneRun(runtime.config, run) satisfies Wire<FullExperiment>)
    } catch (error) {
      if (error instanceof BackendProjectServiceError && error.code === 'RESOURCE_NOT_FOUND')
        continue
      throw error
    }
  }
  return NextResponse.json(
    { error: { code: 'NOT_FOUND', message: `experiment "${id}" not found` } },
    { status: 404 },
  )
}
