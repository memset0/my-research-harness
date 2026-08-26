// GET /api/projects/<project>/submodules — local submodule list.
//
// Owner + viewer-in-scope can read. Returns the discriminated-union
// from `readGitSubmodules` directly.

import { BackendGitSubmodulesResponseSchema } from '@memon/core'
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
    return NextResponse.json(
      BackendGitSubmodulesResponseSchema.parse(await context.git.submodules(context.project)),
    )
  } catch (error) {
    return gitServiceError(error)
  }
}
