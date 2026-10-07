import { withStandaloneRequest } from '../../../../lib/server/standalone-request'
// GET /api/wiki/review?project=NAME
//
// The wiki-commit log, oldest first, with each commit's verification mark and
// the `verifiedThrough` prefix end. Served from the runtime cache's review
// snapshot, which is refreshed by the Poller on HEAD / ref /
// `.memon/wiki-review.csv` / wiki content changes — never by this request.
// A project outside a git worktree has no review log at all: 404.

import { BackendWikiReviewResponseSchema } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import type { WikiReviewResponse } from '@/lib/dto/wiki'
import { getRuntime } from '../../../../lib/server/runtime'
import { standaloneServices } from '../../../../lib/server/standalone-services'
import { wikiError, wikiProjectTarget } from '../../../../lib/server/wiki-route'

export const dynamic = 'force-dynamic'

async function scopedGET(request: NextRequest) {
  const runtime = await getRuntime()
  const target = wikiProjectTarget(runtime, new URL(request.url).searchParams)
  if ('error' in target) return target.error
  const log = BackendWikiReviewResponseSchema.parse(
    await standaloneServices(runtime.config).documents.wikiReviewLog(target.project),
  )
  if (!log) {
    return wikiError(404, 'NOT_FOUND', `project "${target.project}" is not a git worktree`)
  }
  return NextResponse.json({
    ...log,
    commits: log.commits.map((commit) => ({
      ...commit,
      verifiedAt: commit.verifiedAt ?? null,
      note: commit.note ?? null,
    })),
  } satisfies WikiReviewResponse)
}

export const GET = withStandaloneRequest(scopedGET)
