import { type NextRequest, NextResponse } from 'next/server'
import { readIdentityFromRequest } from '@/lib/auth/request-context'
import { aggregateCentralProjects } from '../../../lib/central/central-projects'
import { getCentralFleet } from '../../../lib/central/fleet-runtime'
import { getRuntime } from '../../../lib/runtime'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  let centralMode = false
  try {
    const rt = await getRuntime()
    const { role, scopeProjects, scopeProjectRefs } = readIdentityFromRequest(req)
    centralMode = rt.config.central !== undefined
    if (centralMode) {
      if (role === 'anon' || (role === 'viewer' && scopeProjectRefs.length === 0)) {
        return NextResponse.json(
          { error: { code: 'FORBIDDEN', message: 'Host-qualified viewer scope is required' } },
          { status: 403, headers: { 'cache-control': 'no-store' } },
        )
      }
      const fleet = await getCentralFleet()
      const payload = await aggregateCentralProjects({
        registry: fleet.registry,
        actor: role === 'viewer' ? { role: 'viewer', scopes: scopeProjectRefs } : { role: 'owner' },
      })
      return NextResponse.json(
        {
          projects: payload.projects.map((project) => ({
            mode: 'central' as const,
            ...project,
            name: project.project,
          })),
        },
        { headers: { 'cache-control': 'no-store' } },
      )
    }

    const filtered =
      role === 'viewer'
        ? rt.config.projects.filter((p) => scopeProjects.has(p.name))
        : rt.config.projects
    return NextResponse.json({
      projects: filtered.map((p) => ({
        mode: 'standalone' as const,
        host: null,
        project: p.name,
        name: p.name,
        root: p.root,
        exclude: p.exclude,
      })),
    })
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          message: centralMode ? 'Central Project discovery failed' : (err as Error).message,
        },
      },
      { status: 500 },
    )
  }
}
