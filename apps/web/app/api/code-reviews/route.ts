// GET /api/code-reviews?project=NAME -> { codeReviews: CodeReviewSummary[] }
//
// Aggregated across the flat docs/code-review/ dir and every per-experiment
// code-review dir, sorted by date desc. Served from the runtime's
// codeReviewsCache (warmed at boot, refreshed by the shared Poller).

import { BackendCodeReviewsResponseSchema } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '../../../lib/runtime'
import { standaloneCodeReview } from '../../../lib/server/standalone-dto'
import { standaloneServices } from '../../../lib/server/standalone-services'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const rt = await getRuntime()
    const projectName = new URL(req.url).searchParams.get('project')
    if (!projectName) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'project query parameter is required' } },
        { status: 400 },
      )
    }
    if (!rt.config.projects.some((p) => p.name === projectName)) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: `project "${projectName}" not configured` } },
        { status: 404 },
      )
    }
    if (rt.config.projects.some((project) => !Array.isArray(project.include))) {
      return NextResponse.json({ codeReviews: rt.getCodeReviewsList(projectName) })
    }
    const codeReviews = BackendCodeReviewsResponseSchema.parse(
      await standaloneServices(rt.config).documents.listCodeReviews(projectName),
    ).codeReviews.map((review) => standaloneCodeReview(rt.config, review))
    return NextResponse.json({ codeReviews })
  } catch (err) {
    return NextResponse.json({ error: { message: (err as Error).message } }, { status: 500 })
  }
}
