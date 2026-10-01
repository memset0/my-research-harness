import { BackendJournalHistoryResponseSchema } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '../../../../lib/server/runtime'
import { standaloneServices } from '../../../../lib/server/standalone-services'

export const dynamic = 'force-dynamic'

/**
 * Owner-only diagnostic history: preserved legacy Journal events plus the typed
 * invocation receipts under `.memon/activity`. Receipt paths and error codes can
 * disclose project internals a share-scoped viewer never sees, so this route is
 * classified owner-only (`shell`) in `lib/server/auth/route-classes.ts` — the legacy
 * `/api/journal` read keeps its own viewer scope.
 */
export async function GET(request: NextRequest) {
  const runtime = await getRuntime()
  const search = new URL(request.url).searchParams
  const project = search.get('project')
  const entry = runtime.config.projects.find((candidate) => candidate.name === project)
  if (!project || !entry)
    return NextResponse.json({ error: { message: 'project not found' } }, { status: 404 })
  const rawLimit = search.get('limit')
  if (rawLimit !== null && !/^\d{1,6}$/.test(rawLimit)) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'limit must be a small positive integer' } },
      { status: 400 },
    )
  }
  try {
    return NextResponse.json(
      BackendJournalHistoryResponseSchema.parse(
        await standaloneServices(runtime.config).projects.getJournalHistory(
          project,
          rawLimit === null ? undefined : Number(rawLimit),
        ),
      ),
    )
  } catch {
    return NextResponse.json({ error: { message: 'journal history read failed' } }, { status: 500 })
  }
}
