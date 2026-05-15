// GET /api/projects/<project>/git-branches — local branches + HEAD info.
//
// Lazy companion to the git-history dialog. Returns the discriminated-union
// payload from `readGitBranches`. Project resolution + viewer-scope match
// the existing git endpoints.

import { NextResponse, type NextRequest } from 'next/server'
import { readGitBranches } from '@memon/core'
import { getRuntime } from '../../../../../lib/runtime'
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

  const result = await readGitBranches(entry.root)
  return NextResponse.json(result)
}
