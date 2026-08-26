// GET /api/projects/<project>/git-status/files — full per-file git status.
//
// Lazy companion to /api/projects/<project>/git-status: that route returns
// counts (cheap, polled every 10s); this one returns the actual staged /
// unstaged / untracked file lists and is fetched once per dialog open.
//
// Same project-resolution + viewer-scope rules as the counts endpoint. No
// server-side throttle — TanStack `staleTime` on the client is sufficient
// because this is user-triggered, not polled.

import { BackendGitStatusFilesResponseSchema } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import {
  gitServiceError,
  standaloneGitContext,
} from '../../../../../../lib/server/standalone-git-route'

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
      BackendGitStatusFilesResponseSchema.parse(
        await context.git.statusFiles(context.project, { submodule }),
      ),
    )
  } catch (error) {
    return gitServiceError(error)
  }
}
