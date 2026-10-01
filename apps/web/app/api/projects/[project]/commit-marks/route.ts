// GET /api/projects/<project>/commit-marks — full per-project mark map.
//
// Both owner and viewer-in-scope sessions can READ; mutations live on
// the `[sha]/route.ts` sibling and are owner-only.

import { BackendCommitMarksResponseSchema } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import type { CommitMarksResponse } from '@/lib/dto/git'
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
      BackendCommitMarksResponseSchema.parse(
        await context.git.commitMarks(context.project),
      ) satisfies CommitMarksResponse,
    )
  } catch (error) {
    return gitServiceError(error)
  }
}
