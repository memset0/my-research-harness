// GET /api/code-reviews?project=NAME -> { codeReviews: CodeReviewSummary[] }
//
// Rich responses preserve the runtime-cache projection where configured.
// `inventory=1` performs direct name/path discovery instead.

import {
  BackendCodeReviewsResponseSchema,
  BackendResourceInventoryResponseSchema,
} from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '../../../lib/runtime'
import { standaloneCodeReview } from '../../../lib/server/standalone-dto'
import { standaloneServices } from '../../../lib/server/standalone-services'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const rt = await getRuntime()
    const search = new URL(req.url).searchParams
    const projectName = search.get('project')
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
    const inventoryOnly = search.get('inventory') === '1'
    if (inventoryOnly) {
      return NextResponse.json(
        BackendResourceInventoryResponseSchema.parse(
          await standaloneServices(rt.config).documents.listCodeReviews(projectName, {
            inventoryOnly: true,
          }),
        ),
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
