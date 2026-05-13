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

import { NextResponse, type NextRequest } from 'next/server'
import { getRuntime } from '@/lib/runtime'
import { publicOrigin } from '@/lib/auth/public-url'
import { addShare, listShares } from '@memon/core'

interface RouteParams {
  params: Promise<{ project: string }>
}

function constructShareUrl(req: NextRequest, project: string, token: string): string {
  // Build the URL against the PUBLIC origin (X-Forwarded-Host/Proto from
  // Caddy), not the internal `http://localhost:3737` Next sees.
  return `${publicOrigin(req)}/share/${encodeURIComponent(project)}/${encodeURIComponent(token)}`
}

async function loadProjectRoot(projectName: string): Promise<string | null> {
  const runtime = await getRuntime()
  const cfg = runtime.config.projects.find((p) => p.name === projectName)
  return cfg ? cfg.root : null
}

export async function GET(req: NextRequest, ctx: RouteParams): Promise<NextResponse> {
  const { project } = await ctx.params
  const root = await loadProjectRoot(project)
  if (!root) {
    return NextResponse.json({ error: 'project not configured' }, { status: 404 })
  }

  const reveal = req.nextUrl.searchParams.get('reveal') === 'true'
  const records = await listShares(root, { includeTokens: reveal })
  return NextResponse.json({ shares: records }, { status: 200 })
}

export async function POST(req: NextRequest, ctx: RouteParams): Promise<NextResponse> {
  const { project } = await ctx.params
  const root = await loadProjectRoot(project)
  if (!root) {
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
    const record = await addShare(root, { label, expires })
    const shareUrl = constructShareUrl(req, project, record.token)
    return NextResponse.json(
      { share: { ...record, share_url: shareUrl } },
      { status: 201 },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'failed to create share'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
