import { type NextRequest, NextResponse } from 'next/server'
import { readIdentityFromRequest } from '@/lib/server/auth/request-context'
import {
  parseResultsViewScope,
  parseViewMutation,
  validResultsViewId,
} from '@/lib/server/experiment-results-view-route'
import {
  getExperimentResultsViewsStore,
  ResultsViewConflictError,
  ResultsViewNotFoundError,
} from '@/lib/server/experiment-results-views-store'
import { getRuntime } from '@/lib/server/runtime'

export const dynamic = 'force-dynamic'

const HEADERS = { 'Cache-Control': 'no-store' }

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PATCH(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  if (readIdentityFromRequest(req).role !== 'owner') return error('Forbidden', 403)
  const runtime = await getRuntime()
  const scope = parseResultsViewScope(req, runtime.config.central !== undefined)
  if (!scope) return error('A valid exact Experiment scope is required', 400)
  const { id } = await context.params
  if (!validResultsViewId(id)) return error('Invalid View ID', 400)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return error('Invalid JSON body', 400)
  }
  const mutation = parseViewMutation(body)
  if (!mutation) return error('A valid View name or complete definition is required', 400)

  try {
    const view = await getExperimentResultsViewsStore(runtime.configPath).update(
      scope,
      id,
      mutation,
    )
    return NextResponse.json({ view }, { headers: HEADERS })
  } catch (caught) {
    if (caught instanceof ResultsViewNotFoundError) return error(caught.message, 404)
    if (caught instanceof ResultsViewConflictError) return error(caught.message, 409)
    throw caught
  }
}

export async function DELETE(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  if (readIdentityFromRequest(req).role !== 'owner') return error('Forbidden', 403)
  const runtime = await getRuntime()
  const scope = parseResultsViewScope(req, runtime.config.central !== undefined)
  if (!scope) return error('A valid exact Experiment scope is required', 400)
  const { id } = await context.params
  if (!validResultsViewId(id)) return error('Invalid View ID', 400)

  try {
    await getExperimentResultsViewsStore(runtime.configPath).delete(scope, id)
    return new NextResponse(null, { status: 204, headers: HEADERS })
  } catch (caught) {
    if (caught instanceof ResultsViewNotFoundError) return error(caught.message, 404)
    throw caught
  }
}

function error(message: string, status: number): NextResponse {
  return NextResponse.json({ error: { message } }, { status, headers: HEADERS })
}
