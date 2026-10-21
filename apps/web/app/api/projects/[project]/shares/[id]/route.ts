// DELETE /api/projects/<project>/shares/<id> — owner-only revoke.

import { AmbiguousShareError, ShareNotFoundError } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '@/lib/server/runtime'
import { standaloneServices } from '@/lib/server/standalone-services'

interface RouteParams {
  params: Promise<{ project: string; id: string }>
}

export async function DELETE(_req: NextRequest, ctx: RouteParams): Promise<Response> {
  const { project, id } = await ctx.params
  if (!project || !id) {
    return NextResponse.json({ error: 'missing project or id' }, { status: 400 })
  }
  const runtime = await getRuntime()
  if (runtime.config.central) {
    return NextResponse.json(
      { error: { code: 'GONE', message: 'central share links are managed at /api/shares' } },
      { status: 410 },
    )
  }
  if (!runtime.config.projects.some((candidate) => candidate.name === project)) {
    return NextResponse.json({ error: 'project not configured' }, { status: 404 })
  }
  try {
    const removed = await standaloneServices(runtime.config).shares.revoke(project, id)
    return NextResponse.json({ revoked: removed }, { status: 200 })
  } catch (err) {
    if (err instanceof ShareNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    if (err instanceof AmbiguousShareError) {
      return NextResponse.json({ error: err.message, matches: err.matches }, { status: 409 })
    }
    const message = err instanceof Error ? err.message : 'failed to revoke share'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
