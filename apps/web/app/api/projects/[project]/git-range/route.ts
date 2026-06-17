// GET /api/projects/<project>/git-range?from=<sha>&to=<sha>&submodule=<name>
//
// Returns the submodule (or main repo) commit list AND file list for the
// range `from..to`. Used by `<SubmoduleBumpRow />` when the user expands a
// main-repo commit's submodule-pointer entry to review what changed inside
// the submodule between the two pinned SHAs.

import { NextResponse, type NextRequest } from 'next/server'
import { readGitRange } from '@memon/core'
import { getRuntime } from '../../../../../lib/runtime'
import { resolveSubmoduleCwd } from '../../../../../lib/server/resolve-submodule-cwd'
import { readIdentityFromRequest } from '@/lib/auth/request-context'

export const dynamic = 'force-dynamic'

const SAFE_REF_REGEX = /^[A-Za-z0-9_\-/.~^]+$/

interface RouteParams {
  params: Promise<{ project: string }>
}

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: { message } }, { status: 400 })
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

  const url = new URL(req.url)
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  if (!from) return badRequest('missing from')
  if (!to) return badRequest('missing to')
  if (from.length > 200 || !SAFE_REF_REGEX.test(from)) {
    return badRequest('invalid from')
  }
  if (to.length > 200 || !SAFE_REF_REGEX.test(to)) {
    return badRequest('invalid to')
  }

  const submoduleParam = url.searchParams.get('submodule')
  const resolved = await resolveSubmoduleCwd(entry.root, submoduleParam)
  if (!resolved.ok) {
    return NextResponse.json(
      { error: { message: resolved.message } },
      { status: resolved.status },
    )
  }

  const result = await readGitRange(resolved.cwd, { from, to })
  if (result.enabled) {
    return NextResponse.json({ ...result, submodule: resolved.submodule })
  }
  return NextResponse.json(result)
}
