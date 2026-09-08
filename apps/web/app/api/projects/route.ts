import { type NextRequest, NextResponse } from 'next/server'
import { readIdentityFromRequest } from '@/lib/auth/request-context'
import { aggregateCentralProjects } from '../../../lib/central/central-projects'
import { servesProjectsDirectly } from '../../../lib/central/direct-projects'
import { directCentralRuntime } from '../../../lib/central/direct-runtime'
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
      const inScope = (project: { host: string; project: string }) =>
        role !== 'viewer' ||
        scopeProjectRefs.some(
          (scope) => scope.host === project.host && scope.project === project.project,
        )
      // Directly served Projects are configured, not discovered: listing them
      // reads configuration only and touches no Project filesystem.
      const direct = servesProjectsDirectly(rt.config)
        ? directCentralRuntime(rt.config).registry.listProjects().filter(inScope)
        : []
      const remote =
        (rt.config.central?.hosts.length ?? 0) > 0
          ? (
              await aggregateCentralProjects({
                registry: (await getCentralFleet()).registry,
                actor:
                  role === 'viewer' ? { role: 'viewer', scopes: scopeProjectRefs } : { role: 'owner' },
              })
            ).projects
          : []
      return NextResponse.json(
        {
          projects: [...direct, ...remote].map((project) => ({
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
