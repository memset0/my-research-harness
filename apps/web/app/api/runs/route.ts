import { BackendProjectServiceError, BackendRunsPageResponseSchema } from '@memon/backend'
import { BackendResourceInventoryResponseSchema, isStaleRunning } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import type { RunsResponse } from '@/lib/dto/runs'
import type { Wire } from '@/lib/dto/wire'
import { getRuntime } from '../../../lib/server/runtime'
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
      } satisfies Wire<RunsResponse>)
    }
    const selected = search.get('project')
    const projects = selected
      ? runtime.config.projects.filter((project) => project.name === selected)
      : runtime.config.projects
    const inventoryOnly = search.get('inventory') === '1'
    const services = standaloneServices(runtime.config)
    if (inventoryOnly) {
      const responses = await Promise.all(
        projects.map((project) =>
          services.projects.listRuns(project.name, deprecationFilter, { inventoryOnly }),
        ),
      )
      return NextResponse.json({
        items: responses.flatMap(
          (response) => BackendResourceInventoryResponseSchema.parse(response).items,
        ),
      })
    }
    const limitValue = search.get('limit')
    const cursor = search.get('cursor')
    if (limitValue !== null && !/^[1-9]\d{0,3}$/.test(limitValue)) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'limit must be an integer from 1 to 1000' } },
        { status: 400 },
      )
    }
    // One selected Project is paged like the central list; an unselected
    // multi-Project read follows every page itself.
    const page = (name: string, next: string | null) =>
      services.projects
        .listRuns(name, deprecationFilter, {
          inventoryOnly: false,
          ...(limitValue === null ? {} : { limit: Number(limitValue) }),
          ...(next === null ? {} : { cursor: next }),
        })
        .then((response) => BackendRunsPageResponseSchema.parse(response))
    if (selected) {
      const result = await page(selected, cursor)
      return NextResponse.json({
        experiments: result.runs.map((run: (typeof result.runs)[number]) =>
          standaloneRun(runtime.config, run),
        ),
        nextCursor: result.nextCursor,
      } satisfies Wire<RunsResponse>)
    }
    const runs = []
    for (const project of projects) {
      let next: string | null = null
      do {
        const result = await page(project.name, next)
        runs.push(
          ...result.runs.map((run: (typeof result.runs)[number]) =>
            standaloneRun(runtime.config, run),
          ),
        )
        next = result.nextCursor
      } while (next !== null)
    }
    return NextResponse.json({ experiments: runs, nextCursor: null } satisfies Wire<RunsResponse>)
  } catch (error) {
    if (error instanceof BackendProjectServiceError && error.code === 'INVALID_RESOURCE') {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: error.message } },
        { status: 400 },
      )
    }
    return NextResponse.json({ error: { message: 'Run discovery failed' } }, { status: 500 })
  }
}
