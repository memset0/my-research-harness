// GET /api/projects/<project>/git-log?ref=<ref>&limit=<N> — commit list.
//
// Returns up to <limit> newest commits on <ref>. `ref` is validated against
// a safe character class before being passed to git. `limit` is bounded
// 1..1000 with a default of 100.

import { NextResponse, type NextRequest } from 'next/server'
import { readGitLog } from '@memon/core'
import { getRuntime } from '../../../../../lib/runtime'
import { readIdentityFromRequest } from '@/lib/auth/request-context'

export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 1000
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
  const ref = url.searchParams.get('ref')
  if (!ref) return badRequest('missing ref')
  if (ref.length > 200 || !SAFE_REF_REGEX.test(ref)) {
    return badRequest('invalid ref')
  }

  const limitParam = url.searchParams.get('limit')
  let limit = DEFAULT_LIMIT
  if (limitParam !== null) {
    const parsed = Number.parseInt(limitParam, 10)
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
      return badRequest(`limit must be a positive integer ≤ ${MAX_LIMIT}`)
    }
    limit = parsed
  }

  const result = await readGitLog(entry.root, { ref, limit })
  return NextResponse.json(result)
}
