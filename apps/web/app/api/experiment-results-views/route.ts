import { type NextRequest, NextResponse } from 'next/server'
import { readIdentityFromRequest } from '@/lib/auth/request-context'
import { getRuntime } from '@/lib/runtime'
import {
  canReadResultsViewScope,
  parseResultsViewScope,
  parseViewDefinition,
  parseViewName,
} from '@/lib/server/experiment-results-view-route'
import {
  getExperimentResultsViewsStore,
  ResultsViewConflictError,
} from '@/lib/server/experiment-results-views-store'

export const dynamic = 'force-dynamic'

const HEADERS = { 'Cache-Control': 'no-store' }

export async function GET(req: NextRequest): Promise<NextResponse> {
  const runtime = await getRuntime()
  const scope = parseResultsViewScope(req, runtime.config.central !== undefined)
  if (!scope) return error('A valid exact Experiment scope is required', 400)
  const identity = readIdentityFromRequest(req)
  if (!canReadResultsViewScope(identity, scope)) return error('Forbidden', 403)

  const views = await getExperimentResultsViewsStore(runtime.configPath).list(scope)
  return NextResponse.json({ views, canMutate: identity.role === 'owner' }, { headers: HEADERS })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const identity = readIdentityFromRequest(req)
  if (identity.role !== 'owner') return error('Forbidden', 403)
  const runtime = await getRuntime()
  const scope = parseResultsViewScope(req, runtime.config.central !== undefined)
  if (!scope) return error('A valid exact Experiment scope is required', 400)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return error('Invalid JSON body', 400)
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return error('Body must contain name and definition', 400)
  }
  const record = body as Record<string, unknown>
  if (Object.keys(record).some((key) => key !== 'name' && key !== 'definition')) {
    return error('Body contains unsupported fields', 400)
  }
  const name = parseViewName(record.name)
  const definition = parseViewDefinition(record.definition)
  if (!name || !definition)
    return error('A valid name and complete View definition are required', 400)

  try {
    const view = await getExperimentResultsViewsStore(runtime.configPath).create(
      scope,
      name,
      definition,
    )
    return NextResponse.json({ view }, { status: 201, headers: HEADERS })
  } catch (caught) {
    if (caught instanceof ResultsViewConflictError) return error(caught.message, 409)
    throw caught
  }
}

function error(message: string, status: number): NextResponse {
  return NextResponse.json({ error: { message } }, { status, headers: HEADERS })
}
