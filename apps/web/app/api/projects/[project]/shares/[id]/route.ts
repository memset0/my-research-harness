// DELETE /api/projects/<project>/shares/<id> — owner-only revoke.

import { AmbiguousShareError, HostIdSchema, ShareNotFoundError } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import { proxyCentralApiRequest } from '@/lib/central/backend-proxy'
import { getCentralFleet } from '@/lib/central/fleet-runtime'
import { getRuntime } from '@/lib/runtime'
import { standaloneServices } from '@/lib/server/standalone-services'

interface RouteParams {
  params: Promise<{ project: string; id: string }>
}

export async function DELETE(req: NextRequest, ctx: RouteParams): Promise<Response> {
  const { project, id } = await ctx.params
  if (!project || !id) {
    return NextResponse.json({ error: 'missing project or id' }, { status: 400 })
  }
  const runtime = await getRuntime()
  if (runtime.config.central) {
    const hosts = req.nextUrl.searchParams.getAll('host')
    const host = hosts.length === 1 ? HostIdSchema.safeParse(hosts[0]) : null
    if (!host?.success) {
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
  try {
    const removed = await standaloneServices(runtime.config).shares.revoke(project, id)
    return NextResponse.json({ revoked: removed }, { status: 200 })
  } catch (err) {
    if (err instanceof ShareNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    if (err instanceof AmbiguousShareError) {
      return NextResponse.json({ error: err.message, matches: err.matches }, { status: 409 })
    }
    const message = err instanceof Error ? err.message : 'failed to revoke share'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
