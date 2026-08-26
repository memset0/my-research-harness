// GET /api/projects/<project>/git-diff — shared standalone Git adapter.

import { BackendGitDiffResponseSchema } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import {
  gitError,
  gitServiceError,
  standaloneGitContext,
} from '../../../../../lib/server/standalone-git-route'

export const dynamic = 'force-dynamic'

type Side = 'staged' | 'unstaged' | 'untracked' | 'commit' | 'range'

interface RouteParams {
  params: Promise<{ project: string }>
}

function side(input: string | null): Side | null {
  return input === 'staged' ||
    input === 'unstaged' ||
    input === 'untracked' ||
    input === 'commit' ||
    input === 'range'
    ? input
    : null
}

export async function GET(request: NextRequest, context: RouteParams): Promise<NextResponse> {
  const { project: rawProject } = await context.params
  const resolved = await standaloneGitContext(request, rawProject)
  if (resolved instanceof NextResponse) return resolved
  const search = new URL(request.url).searchParams
  const path = search.get('path')
  const selectedSide = side(search.get('side'))
  if (!path) return gitError(400, 'missing path')
  if (!selectedSide) return gitError(400, 'side must be staged|unstaged|untracked|commit|range')
  try {
    return NextResponse.json(
      BackendGitDiffResponseSchema.parse(
        await resolved.git.diff(resolved.project, {
          path,
          side: selectedSide,
          ...(search.get('sha') ? { sha: search.get('sha')! } : {}),
          ...(search.get('from') ? { from: search.get('from')! } : {}),
          ...(search.get('to') ? { to: search.get('to')! } : {}),
          ...(search.get('submodule') ? { submodule: search.get('submodule')! } : {}),
        }),
      ),
    )
  } catch (error) {
    return gitServiceError(error)
  }
}
