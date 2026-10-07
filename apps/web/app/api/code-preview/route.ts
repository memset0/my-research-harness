import { withStandaloneRequest } from '../../../lib/server/standalone-request'
// GET /api/code-preview?project=<name>&url=<github-permalink> — shared standalone Git adapter.

import { BackendCodePreviewResponseSchema, parseGithubPermalink } from '@memon/core'
import { join } from '@memon/file-protocol/paths'
import { type NextRequest, NextResponse } from 'next/server'
import type { CodePreview } from '@/lib/dto/code-reviews'
import { assertWithinProjectRoots, PathSafetyError } from '../../../lib/server/path-safety'
import {
  gitError,
  gitServiceError,
  standaloneGitContext,
} from '../../../lib/server/standalone-git-route'

export const dynamic = 'force-dynamic'

async function scopedGET(request: NextRequest): Promise<NextResponse> {
  const search = new URL(request.url).searchParams
  const context = await standaloneGitContext(request, search.get('project'))
  if (context instanceof NextResponse) return context
  const url = search.get('url')
  if (!url) return gitError(400, 'url query parameter is required')
  const link = parseGithubPermalink(url)
  if (!link) return gitError(400, 'url is not a GitHub blob line-permalink')
  // Effective mappings: deprecated central `github`, else `.memon/project.yml`.
  let mappings: Awaited<ReturnType<typeof context.git.githubMappings>>['mappings']
  try {
    mappings = (await context.git.githubMappings(context.project)).mappings
  } catch (error) {
    return gitServiceError(error)
  }
  const mapping = mappings.find(
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

export const GET = withStandaloneRequest(scopedGET)
