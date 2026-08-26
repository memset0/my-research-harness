import { BackendRunResponseSchema, BackendRunsResponseSchema } from '@memon/core'
import { NextResponse } from 'next/server'
import { getRuntime } from '../../../../lib/runtime'
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
    const exists = BackendRunsResponseSchema.parse(
      await services.projects.listRuns(project.name),
    ).runs.some((run) => run.id === id)
    if (!exists) continue
    const run = BackendRunResponseSchema.parse(await services.projects.getRun(project.name, id))
    runtime.pokeById(id)
    return NextResponse.json(standaloneRun(runtime.config, run))
  }
  return NextResponse.json(
    { error: { code: 'NOT_FOUND', message: `experiment "${id}" not found` } },
    { status: 404 },
  )
}
