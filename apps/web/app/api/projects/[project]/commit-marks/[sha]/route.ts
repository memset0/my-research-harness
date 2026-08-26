// PUT|DELETE /api/projects/<project>/commit-marks/<sha> — shared standalone Git adapter.

import {
  BackendCommitMarkDeleteResponseSchema,
  BackendCommitMarkWriteRequestSchema,
  BackendCommitMarkWriteResponseSchema,
} from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import {
  gitError,
  gitServiceError,
  standaloneGitContext,
} from '../../../../../../lib/server/standalone-git-route'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ project: string; sha: string }>
}

async function target(request: NextRequest, context: RouteParams) {
  const params = await context.params
  const resolved = await standaloneGitContext(request, params.project, 'mutating')
  if (resolved instanceof NextResponse) return resolved
  let sha: string
  try {
    sha = decodeURIComponent(params.sha)
  } catch {
    return gitError(400, 'invalid sha')
  }
  return {
    ...resolved,
    sha,
    submodule: new URL(request.url).searchParams.get('submodule') ?? undefined,
  }
}

export async function PUT(request: NextRequest, context: RouteParams): Promise<NextResponse> {
  const resolved = await target(request, context)
  if (resolved instanceof NextResponse) return resolved
  let input: unknown
  try {
    input = await request.json()
  } catch {
    return gitError(400, 'invalid JSON body')
  }
  const parsed = BackendCommitMarkWriteRequestSchema.safeParse(input)
  if (!parsed.success) return gitError(400, 'commit mark request is invalid')
  try {
    return NextResponse.json(
      BackendCommitMarkWriteResponseSchema.parse(
        await resolved.git.setCommitMark(resolved.project, resolved.sha, {
          ...parsed.data,
          submodule: resolved.submodule,
        }),
      ),
    )
  } catch (error) {
    return gitServiceError(error)
  }
}

export async function DELETE(request: NextRequest, context: RouteParams): Promise<NextResponse> {
  const resolved = await target(request, context)
  if (resolved instanceof NextResponse) return resolved
  try {
    return NextResponse.json(
      BackendCommitMarkDeleteResponseSchema.parse(
        await resolved.git.deleteCommitMark(resolved.project, resolved.sha, {
          submodule: resolved.submodule,
        }),
      ),
    )
  } catch (error) {
    return gitServiceError(error)
  }
}
