// GET /api/projects/<project>/git-commit?sha=<x> — one commit's detail.
//
// Returns metadata + file-status list for a single commit. `sha` is
// validated against a safe character class before being passed to git.

import { BackendGitCommitResponseSchema } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import type { GitCommitDetail } from '@/lib/dto/git'
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
  const sha = url.searchParams.get('sha')
  if (!sha) return badRequest('missing sha')
  try {
    return NextResponse.json(
      BackendGitCommitResponseSchema.parse(
        await context.git.commit(context.project, sha, {
          submodule: url.searchParams.get('submodule') ?? undefined,
        }),
      ) satisfies GitCommitDetail,
    )
  } catch (error) {
    return gitServiceError(error)
  }
}
