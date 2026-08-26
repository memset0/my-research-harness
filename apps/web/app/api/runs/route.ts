import { BackendRunsResponseSchema, isStaleRunning } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '../../../lib/runtime'
import { standaloneRun } from '../../../lib/server/standalone-dto'
import { standaloneServices } from '../../../lib/server/standalone-services'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const runtime = await getRuntime()
    if (!runtime.config) {
      const project = new URL(request.url).searchParams.get('project') ?? undefined
      const experiments = runtime.index.list({ project })
      return NextResponse.json({
        experiments: experiments.map((run) => ({ ...run, stale: isStaleRunning(run) })),
      })
    }
    const selected = new URL(request.url).searchParams.get('project')
    const projects = selected
      ? runtime.config.projects.filter((project) => project.name === selected)
      : runtime.config.projects
    const runs = (
      await Promise.all(
        projects.map(async (project) =>
          BackendRunsResponseSchema.parse(
            await standaloneServices(runtime.config).projects.listRuns(project.name),
          ).runs.map((run) => standaloneRun(runtime.config, run)),
        ),
      )
    ).flat()
    return NextResponse.json({ experiments: runs })
  } catch {
    return NextResponse.json({ error: { message: 'Run discovery failed' } }, { status: 500 })
  }
}
