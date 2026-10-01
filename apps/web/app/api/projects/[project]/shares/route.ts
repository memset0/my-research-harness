// GET / POST /api/projects/<project>/shares — owner-only share management.
//
// Middleware classifies this path as `mutating` (even for GET), so viewers
// get 401 before reaching this handler. Owner identity is the only thing
// that gets here.
//
// GET ?reveal=<truthy>      — list shares including `token` (rare; the
//                              dashboard uses POST's response to construct
//                              the initial URL).
// GET (default)             — list shares with `token` omitted (the field
//                              is empty string).
// POST { label?, expires? } — create a new share; respond 201 with the full
//                              record plus a constructed `share_url`.

import { BackendShareCreateResponseSchema, HostIdSchema } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import { publicOrigin } from '@/lib/server/auth/public-url'
import { proxyCentralApiRequest } from '@/lib/server/central/backend-proxy'
import { getCentralFleet } from '@/lib/server/central/fleet-runtime'
import { getRuntime } from '@/lib/server/runtime'
import { standaloneServices } from '@/lib/server/standalone-services'

interface RouteParams {
  params: Promise<{ project: string }>
}

function constructShareUrl(req: NextRequest, project: string, token: string): string {
  // Build the URL against the PUBLIC origin (X-Forwarded-Host/Proto from
  // Caddy), not the internal `http://localhost:3737` Next sees.
  return `${publicOrigin(req)}/share/${encodeURIComponent(project)}/${encodeURIComponent(token)}`
}

function constructCentralShareUrl(
  req: NextRequest,
  host: string,
  project: string,
  token: string,
): string {
  return `${publicOrigin(req)}/share/${encodeURIComponent(host)}/${encodeURIComponent(project)}/${encodeURIComponent(token)}`
}

function exactCentralHost(req: NextRequest): string | null {
  const values = req.nextUrl.searchParams.getAll('host')
  if (values.length !== 1) return null
  const parsed = HostIdSchema.safeParse(values[0])
  return parsed.success ? parsed.data : null
}

async function readCentralCreateResponse(response: Response): Promise<unknown> {
  const maxBytes = 64 * 1024
  const declared = response.headers.get('content-length')
  if (declared !== null && Number(declared) > maxBytes) throw new Error('response too large')
  const text = await response.text()
  if (Buffer.byteLength(text) > maxBytes) throw new Error('response too large')
  return JSON.parse(text)
}

export async function GET(req: NextRequest, ctx: RouteParams): Promise<Response> {
  const { project } = await ctx.params
  const runtime = await getRuntime()
  if (runtime.config.central) {
    const host = exactCentralHost(req)
    if (!host) {
      return NextResponse.json({ error: 'exact host query parameter required' }, { status: 400 })
    }
    const fleet = await getCentralFleet()
    return proxyCentralApiRequest(req, {
      registry: fleet.registry,
      actor: { role: 'owner' },
    })
  }
  if (!runtime.config.projects.some((candidate) => candidate.name === project)) {
    return NextResponse.json({ error: 'project not configured' }, { status: 404 })
  }

  const reveal = req.nextUrl.searchParams.get('reveal') === 'true'
  const records = await standaloneServices(runtime.config).shares.list(project, reveal)
  return NextResponse.json({ shares: records }, { status: 200 })
}

export async function POST(req: NextRequest, ctx: RouteParams): Promise<Response> {
  const { project } = await ctx.params
  const runtime = await getRuntime()
  if (runtime.config.central) {
    const host = exactCentralHost(req)
    if (!host) {
      return NextResponse.json({ error: 'exact host query parameter required' }, { status: 400 })
    }
    const fleet = await getCentralFleet()
    const backendResponse = await proxyCentralApiRequest(req, {
      registry: fleet.registry,
      actor: { role: 'owner' },
    })
    if (backendResponse.status !== 201) return backendResponse
    try {
      const payload = BackendShareCreateResponseSchema.parse(
        await readCentralCreateResponse(backendResponse),
      )
      const shareUrl = constructCentralShareUrl(req, host, project, payload.share.token)
      return NextResponse.json(
        { share: { ...payload.share, share_url: shareUrl } },
        { status: 201, headers: { 'cache-control': 'no-store' } },
      )
    } catch {
      return NextResponse.json(
        { error: 'Backend returned an invalid share response' },
        { status: 502, headers: { 'cache-control': 'no-store' } },
      )
    }
  }
  if (!runtime.config.projects.some((candidate) => candidate.name === project)) {
    return NextResponse.json({ error: 'project not configured' }, { status: 404 })
  }

  let label: string | undefined
  let expires: string | undefined
  const contentType = req.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    try {
      const body = (await req.json()) as { label?: string; expires?: string }
      label = body.label
      expires = body.expires
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
    }
  } else if (contentType.includes('application/x-www-form-urlencoded')) {
    const text = await req.text()
    const form = new URLSearchParams(text)
    label = form.get('label') ?? undefined
    expires = form.get('expires') ?? undefined
  }

  try {
    const record = await standaloneServices(runtime.config).shares.add(project, { label, expires })
    const shareUrl = constructShareUrl(req, project, record.token)
    return NextResponse.json({ share: { ...record, share_url: shareUrl } }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'failed to create share'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
