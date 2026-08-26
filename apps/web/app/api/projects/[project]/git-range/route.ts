// GET /api/projects/<project>/git-range?from=<sha>&to=<sha>&submodule=<name>
//
// Returns the submodule (or main repo) commit list AND file list for the
// range `from..to`. Used by `<SubmoduleBumpRow />` when the user expands a
// main-repo commit's submodule-pointer entry to review what changed inside
// the submodule between the two pinned SHAs.

import { BackendGitRangeResponseSchema } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import {
  gitServiceError,
  standaloneGitContext,
} from '../../../../../lib/server/standalone-git-route'

export const dynamic = 'force-dynamic'

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
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  if (!from) return badRequest('missing from')
  if (!to) return badRequest('missing to')
  try {
    return NextResponse.json(
      BackendGitRangeResponseSchema.parse(
        await context.git.range(context.project, {
          from,
          to,
          submodule: url.searchParams.get('submodule') ?? undefined,
        }),
      ),
    )
  } catch (error) {
    return gitServiceError(error)
  }
}
