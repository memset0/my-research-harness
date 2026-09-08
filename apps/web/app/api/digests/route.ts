// GET /api/digests?project=NAME
//
// Returns the list of digests for a project — id, date, path, mtime, title.
// Reads from the runtime's digestsCache. Sorted by date desc.

import {
  BackendDigestsResponseSchema,
  BackendResourceInventoryResponseSchema,
} from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '../../../lib/runtime'
import { standaloneDigest } from '../../../lib/server/standalone-dto'
import { standaloneServices } from '../../../lib/server/standalone-services'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const rt = await getRuntime()
    const url = new URL(req.url)
    const projectName = url.searchParams.get('project')
    if (!projectName) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'project query parameter is required' } },
        { status: 400 },
      )
    }
    if (!rt.config.projects.some((project) => project.name === projectName)) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: `project "${projectName}" not configured` } },
        { status: 404 },
      )
    }
    const inventoryOnly = url.searchParams.get('inventory') === '1'
    const result = await standaloneServices(rt.config).documents.listDigests(projectName, {
      inventoryOnly,
    })
    if (inventoryOnly) {
      return NextResponse.json(BackendResourceInventoryResponseSchema.parse(result))
    }
    const digests = BackendDigestsResponseSchema.parse(result).digests.map((digest) =>
      standaloneDigest(rt.config, digest),
    )
    return NextResponse.json({ digests })
  } catch (err) {
    return NextResponse.json({ error: { message: (err as Error).message } }, { status: 500 })
  }
}
