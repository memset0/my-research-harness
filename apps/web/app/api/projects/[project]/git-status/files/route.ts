// GET /api/projects/<project>/git-status/files — full per-file git status.
//
// Lazy companion to /api/projects/<project>/git-status: that route returns
// counts (cheap, polled every 10s); this one returns the actual staged /
// unstaged / untracked file lists and is fetched once per dialog open.
//
// Same project-resolution + viewer-scope rules as the counts endpoint. No
// server-side throttle — TanStack `staleTime` on the client is sufficient
// because this is user-triggered, not polled.

import { NextResponse, type NextRequest } from 'next/server'
import { readGitStatusFiles } from '@memon/core'
import { getRuntime } from '../../../../../../lib/runtime'
import { readIdentityFromRequest } from '@/lib/auth/request-context'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ project: string }>
}

export async function GET(req: NextRequest, ctx: RouteParams): Promise<NextResponse> {
  const { project: rawProject } = await ctx.params
  const project = decodeURIComponent(rawProject)

  const rt = await getRuntime()
  const entry = rt.config.projects.find((p) => p.name === project)
  if (!entry) {
    return NextResponse.json(
      { error: { message: 'project not found' } },
      { status: 404 },
    )
  }

  const { role, scopeProjects } = readIdentityFromRequest(req)
  if (role === 'viewer' && !scopeProjects.has(project)) {
    return NextResponse.json(
      { error: { message: 'forbidden' } },
      { status: 403 },
    )
  }

  const result = await readGitStatusFiles(entry.root)
  return NextResponse.json(result)
}
