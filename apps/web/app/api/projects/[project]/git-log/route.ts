// GET /api/projects/<project>/git-log?ref=<ref>&limit=<N> — commit list.
//
// Returns up to <limit> newest commits on <ref>. `ref` is validated against
// a safe character class before being passed to git. `limit` is bounded
// 1..1000 with a default of 100.

import { BackendGitLogResponseSchema } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import type { GitLog } from '@/lib/dto/git'
import {
  gitServiceError,
  standaloneGitContext,
} from '../../../../../lib/server/standalone-git-route'

export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 1000

interface RouteParams {
  params: Promise<{ project: string }>
}

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: { message } }, { status: 400 })
}

export async function GET(req: NextRequest, ctx: RouteParams): Promise<NextResponse> {
  const { project: rawProject } = await ctx.params
  const context = await standaloneGitContext(req, rawProject)
  if (context instanceof NextResponse) return context

  const url = new URL(req.url)
  const ref = url.searchParams.get('ref')
  if (!ref) return badRequest('missing ref')

  const limitParam = url.searchParams.get('limit')
  let limit = DEFAULT_LIMIT
  if (limitParam !== null) {
    const parsed = Number.parseInt(limitParam, 10)
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
      return badRequest(`limit must be a positive integer ≤ ${MAX_LIMIT}`)
    }
    limit = parsed
  }

  try {
    return NextResponse.json(
      BackendGitLogResponseSchema.parse(
        await context.git.log(context.project, {
          ref,
          limit,
          submodule: url.searchParams.get('submodule') ?? undefined,
        }),
      ) satisfies GitLog,
    )
  } catch (error) {
    return gitServiceError(error)
  }
}
