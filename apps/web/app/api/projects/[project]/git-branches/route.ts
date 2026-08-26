// GET /api/projects/<project>/git-branches — local branches + HEAD info.
//
// Lazy companion to the git-history dialog. Returns the discriminated-union
// payload from `readGitBranches`. Project resolution + viewer-scope match
// the existing git endpoints.

import { BackendGitBranchesResponseSchema } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import {
  gitServiceError,
  standaloneGitContext,
} from '../../../../../lib/server/standalone-git-route'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ project: string }>
}

export async function GET(req: NextRequest, ctx: RouteParams): Promise<NextResponse> {
  const { project: rawProject } = await ctx.params
  const context = await standaloneGitContext(req, rawProject)
  if (context instanceof NextResponse) return context
  try {
    const submodule = new URL(req.url).searchParams.get('submodule') ?? undefined
    return NextResponse.json(
      BackendGitBranchesResponseSchema.parse(
        await context.git.branches(context.project, { submodule }),
      ),
    )
  } catch (error) {
    return gitServiceError(error)
  }
}
