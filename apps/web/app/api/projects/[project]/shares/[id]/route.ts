// DELETE /api/projects/<project>/shares/<id> — owner-only revoke.

import { NextResponse, type NextRequest } from 'next/server'
import { getRuntime } from '@/lib/runtime'
import { AmbiguousShareError, ShareNotFoundError, revokeShare } from '@memon/core'

interface RouteParams {
  params: Promise<{ project: string; id: string }>
}

async function loadProjectRoot(projectName: string): Promise<string | null> {
  const runtime = await getRuntime()
  const cfg = runtime.config.projects.find((p) => p.name === projectName)
  return cfg ? cfg.root : null
}

export async function DELETE(_req: NextRequest, ctx: RouteParams): Promise<NextResponse> {
  const { project, id } = await ctx.params
  if (!project || !id) {
    return NextResponse.json({ error: 'missing project or id' }, { status: 400 })
  }
  const root = await loadProjectRoot(project)
  if (!root) {
    return NextResponse.json({ error: 'project not configured' }, { status: 404 })
  }
  try {
    const removed = await revokeShare(root, id)
    return NextResponse.json({ revoked: removed }, { status: 200 })
  } catch (err) {
    if (err instanceof ShareNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    if (err instanceof AmbiguousShareError) {
      return NextResponse.json(
        { error: err.message, matches: err.matches },
        { status: 409 },
      )
    }
    const message = err instanceof Error ? err.message : 'failed to revoke share'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
