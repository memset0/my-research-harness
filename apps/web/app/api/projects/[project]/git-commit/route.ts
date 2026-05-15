// GET /api/projects/<project>/git-commit?sha=<x> — one commit's detail.
//
// Returns metadata + file-status list for a single commit. `sha` is
// validated against a safe character class before being passed to git.

import { NextResponse, type NextRequest } from 'next/server'
import { readGitCommit } from '@memon/core'
import { getRuntime } from '../../../../../lib/runtime'
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
  const sha = url.searchParams.get('sha')
  if (!sha) return badRequest('missing sha')
  if (sha.length > 200 || !SAFE_REF_REGEX.test(sha)) {
    return badRequest('invalid sha')
  }

  const result = await readGitCommit(entry.root, sha)
  return NextResponse.json(result)
}
