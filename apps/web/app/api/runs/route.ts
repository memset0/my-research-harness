import {
  BackendResourceInventoryResponseSchema,
  BackendRunsResponseSchema,
  isStaleRunning,
} from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '../../../lib/runtime'
import { standaloneRun } from '../../../lib/server/standalone-dto'
import { standaloneServices } from '../../../lib/server/standalone-services'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const runtime = await getRuntime()
    // Explicit-inspection selector, mirroring the backend Run collection:
    // absent = the research default (deprecated Runs excluded), `include`
    // adds them, `only` returns just them. Single-Run reads never filter.
    const search = new URL(request.url).searchParams
    const deprecated = search.get('deprecated')
    const deprecationFilter = {
      includeDeprecated: deprecated === 'include',
      deprecatedOnly: deprecated === 'only',
    }
    if (!runtime.config) {
      const project = search.get('project') ?? undefined
      const experiments = runtime.index.list({ ...deprecationFilter, project })
      return NextResponse.json({
        experiments: experiments.map((run) => ({ ...run, stale: isStaleRunning(run) })),
      })
    }
    const selected = search.get('project')
    const projects = selected
      ? runtime.config.projects.filter((project) => project.name === selected)
      : runtime.config.projects
    const inventoryOnly = search.get('inventory') === '1'
    const responses = await Promise.all(
      projects.map((project) =>
        standaloneServices(runtime.config).projects.listRuns(
          project.name,
          deprecationFilter,
          { inventoryOnly },
        ),
      ),
    )
    if (inventoryOnly) {
      return NextResponse.json({
        items: responses.flatMap(
          (response) => BackendResourceInventoryResponseSchema.parse(response).items,
        ),
      })
    }
    const runs = responses.flatMap((response) =>
      BackendRunsResponseSchema.parse(response).runs.map((run) =>
        standaloneRun(runtime.config, run),
      ),
    )
    return NextResponse.json({ experiments: runs })
  } catch {
    return NextResponse.json({ error: { message: 'Run discovery failed' } }, { status: 500 })
  }
}
