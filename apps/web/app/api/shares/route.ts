// GET / POST /api/shares — owner-only management of central share links.
//
// GET  [?host=NAME&project=NAME]  every issued link (optionally one Project),
//                                 with token, scope, landing path and share_url.
// POST { host, project, scope, label?, expires?, currentPath?, public?, service? }
//      service: true issues a service link for a service Report/Wiki page
//      (its token also reaches that page's live service); never with public.
//      public: true makes a Report/Wiki page public (idempotent) instead of
//      issuing a token link.
//      scope: { kind: 'project' } | { kind: 'experiment'|'wiki'|'report', id }
//      Document scope must name a published document; the landing path is
//      derived on the server (see share-registry.ts). 201 { share }.
//
// Middleware classifies the path as owner-only; the handler re-checks the role.

import { type NextRequest, NextResponse } from 'next/server'
import type { ScopedShareCreatedResponse, ScopedSharesResponse } from '@/lib/dto/shares'
import { readIdentityFromRequest } from '@/lib/server/auth/request-context'
import { getRuntime } from '@/lib/server/runtime'
import {
  configuredShareProject,
  sharedDocument,
  shareRegistry,
  shareRow,
} from '@/lib/server/share-api'
import {
  isDocumentScope,
  ShareRegistryInputError,
  ShareScopeSchema,
} from '@/lib/server/share-registry'
import { withStandaloneRequest } from '@/lib/server/standalone-request'

export const dynamic = 'force-dynamic'

const forbidden = () =>
  NextResponse.json(
    { error: { code: 'FORBIDDEN', message: 'share management is owner-only' } },
    { status: 403 },
  )
const bad = (message: string, status = 400) =>
  NextResponse.json(
    { error: { code: status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST', message } },
    { status },
  )

export async function GET(req: NextRequest): Promise<Response> {
  if (readIdentityFromRequest(req).role !== 'owner') return forbidden()
  const runtime = await getRuntime()
  const search = req.nextUrl.searchParams
  const project = search.get('project') ?? undefined
  const host = search.get('host')
  try {
    const records = await (await shareRegistry(runtime)).list({
      ...(project === undefined ? {} : { project }),
      ...(host === null ? {} : { host }),
    })
    return NextResponse.json({
      shares: records.map((record) => shareRow(req, record)),
    } satisfies ScopedSharesResponse)
  } catch {
    return bad('share registry is unavailable', 503)
  }
}

async function scopedPOST(req: NextRequest): Promise<Response> {
  if (readIdentityFromRequest(req).role !== 'owner') return forbidden()
  const runtime = await getRuntime()
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return bad('body must be JSON')
  }
  if (typeof body.project !== 'string') return bad('project is required')
  const target = configuredShareProject(
    runtime,
    typeof body.host === 'string' ? body.host : null,
    body.project,
  )
  if (!target) return bad('project is not configured', 404)
  const scope = ShareScopeSchema.safeParse(body.scope)
  if (!scope.success) return bad('invalid share scope')
  const service = body.service === true
  if (service && body.public === true) return bad('a service cannot be public')
  if (isDocumentScope(scope.data)) {
    let document: Awaited<ReturnType<typeof sharedDocument>>
    try {
      document = await sharedDocument(
        runtime,
        target.host,
        target.project,
        scope.data.kind,
        scope.data.id,
      )
    } catch (error) {
      console.error('share: document lookup failed', error)
      return bad(`could not read ${scope.data.kind} ${scope.data.id}; try again`, 503)
    }
    if (!document) return bad(`${scope.data.kind} ${scope.data.id} is not published`, 404)
    if (service && document.presentation !== 'service')
      return bad(`${scope.data.kind} ${scope.data.id} is not a service`)
  } else if (service) {
    return bad('only Report and Wiki services can be shared')
  }
  try {
    const record = await (await shareRegistry(runtime)).create({
      ...target,
      scope: scope.data,
      ...(typeof body.label === 'string' ? { label: body.label } : {}),
      ...(typeof body.expires === 'string' ? { expires: body.expires } : {}),
      currentPath: typeof body.currentPath === 'string' ? body.currentPath : null,
      ...(body.public === true ? { public: true } : {}),
      ...(service ? { service: true } : {}),
    })
    return NextResponse.json(
      { share: shareRow(req, record) } satisfies ScopedShareCreatedResponse,
      {
        status: 201,
      },
    )
  } catch (error) {
    if (error instanceof ShareRegistryInputError) return bad(error.message)
    return bad('share registry is unavailable', 503)
  }
}

export const POST = withStandaloneRequest(scopedPOST)
