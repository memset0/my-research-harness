// POST|DELETE /api/wiki/review/[sha]?project=NAME
//
// Owner-only. POST marks one wiki commit verified (sequentially: marking a
// commit while an older one is unverified is 409 `REVIEW_ORDER`, naming the
// commit that IS markable). DELETE removes the mark and cascades to every
// newer mark. `sha` accepts a full SHA, an unambiguous prefix, or the literal
// `next` (the oldest unverified wiki commit).
//
// Both methods write `.memon/wiki-review.csv` and then refresh the runtime's
// review snapshot, which emits `wiki-review-change` over SSE.

import {
  removeWikiReviewMark,
  WikiReviewError,
  WikiReviewOrderError,
  writeWikiReviewMark,
} from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime, type Runtime } from '../../../../../lib/runtime'
import {
  wikiError,
  wikiProjectTarget,
  withWikiInvocation,
} from '../../../../../lib/server/wiki-route'

export const dynamic = 'force-dynamic'

const SHA_SELECTOR = /^(next|[0-9a-f]{4,40})$/

type RouteContext = { params: Promise<{ sha: string }> }

export async function POST(request: NextRequest, context: RouteContext) {
  const resolved = await resolve(request, context)
  if ('error' in resolved) return resolved.error
  return withWikiInvocation(
    resolved.runtime,
    resolved.project,
    'wiki review mark',
    { sha: resolved.sha },
    async () => {
      if (!SHA_SELECTOR.test(resolved.sha)) {
        return wikiError(400, 'BAD_REQUEST', 'sha must be a hex prefix or `next`')
      }
      if (!resolved.runtime.wikiCache.isGitProject(resolved.project)) {
        return wikiError(404, 'NOT_FOUND', 'project is not a git worktree')
      }
      let note: string | undefined
      try {
        const body = request.headers.get('content-length') === '0' ? null : await request.json()
        const value = (body as { note?: unknown } | null)?.note
        if (typeof value === 'string' && value.trim() !== '') note = value
      } catch {
        // An empty or non-JSON body just means "no note".
      }
      try {
        await writeWikiReviewMark(resolved.root, resolved.sha, note)
      } catch (caught) {
        return reviewFailure(caught)
      }
      return respondWithLog(resolved.runtime, resolved.project)
    },
  )
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const resolved = await resolve(request, context)
  if ('error' in resolved) return resolved.error
  return withWikiInvocation(
    resolved.runtime,
    resolved.project,
    'wiki review unmark',
    { sha: resolved.sha },
    async () => {
      if (!SHA_SELECTOR.test(resolved.sha)) {
        return wikiError(400, 'BAD_REQUEST', 'sha must be a hex prefix or `next`')
      }
      if (!resolved.runtime.wikiCache.isGitProject(resolved.project)) {
        return wikiError(404, 'NOT_FOUND', 'project is not a git worktree')
      }
      try {
        await removeWikiReviewMark(resolved.root, resolved.sha)
      } catch (caught) {
        return reviewFailure(caught)
      }
      return respondWithLog(resolved.runtime, resolved.project)
    },
  )
}

interface ReviewTarget {
  runtime: Runtime
  project: string
  root: string
  sha: string
}

async function resolve(
  request: NextRequest,
  context: RouteContext,
): Promise<ReviewTarget | { error: NextResponse }> {
  const runtime = await getRuntime()
  const target = wikiProjectTarget(runtime, new URL(request.url).searchParams)
  if ('error' in target) return { error: target.error }
  const sha = (await context.params).sha
  const root = runtime.config.projects.find((entry) => entry.name === target.project)?.root
  if (!root) return { error: wikiError(404, 'NOT_FOUND', 'project is not configured') }
  return { runtime, project: target.project, root, sha }
}

/** Re-derive review state, then answer with the fresh log. */
async function respondWithLog(runtime: Runtime, project: string): Promise<NextResponse> {
  await runtime.wikiCache.refreshProjectReview(project)
  const log = runtime.wikiCache.getReviewLog(project)
  if (!log) return wikiError(404, 'NOT_FOUND', `project "${project}" is not a git worktree`)
  return NextResponse.json(log)
}

function reviewFailure(caught: unknown): NextResponse {
  if (caught instanceof WikiReviewOrderError) {
    return NextResponse.json(
      { error: { code: 'REVIEW_ORDER', message: caught.message }, nextSha: caught.nextSha },
      { status: 409 },
    )
  }
  if (caught instanceof WikiReviewError) {
    const status = caught.code === 'NOT_FOUND' ? 404 : caught.code === 'NOT_GIT' ? 404 : 409
    return wikiError(status, caught.code, caught.message)
  }
  return wikiError(500, 'INTERNAL', (caught as Error).message)
}
