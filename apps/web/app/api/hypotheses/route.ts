import { BackendHypothesesResponseSchema } from '@memon/core'
import { join } from '@memon/file-protocol/paths'
import { type NextRequest, NextResponse } from 'next/server'
import type { HypothesesResponse } from '@/lib/dto/journal'
import type { Wire } from '@/lib/dto/wire'
import { getRuntime } from '../../../lib/server/runtime'
import { withStandaloneRequest } from '../../../lib/server/standalone-request'
import { standaloneServices } from '../../../lib/server/standalone-services'

export const dynamic = 'force-dynamic'

async function scopedGET(request: NextRequest) {
  const runtime = await getRuntime()
  const project = new URL(request.url).searchParams.get('project')
  if (!runtime.config) {
    if (!project) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'project query parameter is required' } },
        { status: 400 },
      )
    }
    const path = runtime.hypothesesPath(project)
    if (!path) return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })
    const value = runtime.hypothesesCache.get(path)?.value
    return NextResponse.json({
      path,
      legendBlock: null,
      summaryTableBlock: null,
      entries: [],
      parseErrors: [],
      parseWarnings: [],
      ...(value ?? {}),
    } satisfies Wire<HypothesesResponse>)
  }
  const entry = runtime.config.projects.find((candidate) => candidate.name === project)
  if (!project || !entry)
    return NextResponse.json({ error: { message: 'project not found' } }, { status: 404 })
  try {
    const result = BackendHypothesesResponseSchema.parse(
      await standaloneServices(runtime.config).projects.getHypotheses(project),
    )
    return NextResponse.json({
      path: join(entry.root, 'docs', 'hypotheses.md'),
      ...result,
    } satisfies Wire<HypothesesResponse>)
  } catch {
    return NextResponse.json({ error: { message: 'hypotheses read failed' } }, { status: 500 })
  }
}

export const GET = withStandaloneRequest(scopedGET)
