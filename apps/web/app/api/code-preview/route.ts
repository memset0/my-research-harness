// GET /api/code-preview?project=<name>&url=<github-permalink> — shared standalone Git adapter.

import { join } from 'node:path'
import { BackendCodePreviewResponseSchema, parseGithubPermalink } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import type { CodePreview } from '@/lib/dto/code-reviews'
import { assertWithinProjectRoots, PathSafetyError } from '../../../lib/server/path-safety'
import {
  gitError,
  gitServiceError,
  standaloneGitContext,
} from '../../../lib/server/standalone-git-route'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const search = new URL(request.url).searchParams
  const context = await standaloneGitContext(request, search.get('project'))
  if (context instanceof NextResponse) return context
  const url = search.get('url')
  if (!url) return gitError(400, 'url query parameter is required')
  const link = parseGithubPermalink(url)
  if (!link) return gitError(400, 'url is not a GitHub blob line-permalink')
  const mapping = (
    context.config.projects.find((project) => project.name === context.project)?.github ?? []
  ).find(
    (entry) =>
      entry.owner.toLowerCase() === link.owner.toLowerCase() &&
      entry.repo.toLowerCase() === link.repo.toLowerCase(),
  )
  if (!mapping) return gitError(404, 'no local mapping for GitHub repository')
  try {
    assertWithinProjectRoots(mapping.path, context.config)
    assertWithinProjectRoots(join(mapping.path, link.path), context.config)
  } catch (error) {
    if (error instanceof PathSafetyError) return gitError(403, error.message)
    throw error
  }
  try {
    return NextResponse.json(
      BackendCodePreviewResponseSchema.parse(
        await context.git.codePreview(context.project, url),
      ) satisfies CodePreview,
    )
  } catch (error) {
    return gitServiceError(error)
  }
}
