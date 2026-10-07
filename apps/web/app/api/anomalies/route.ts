import { BackendAnomaliesResponseSchema } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import { readIdentityFromRequest } from '@/lib/server/auth/request-context'
import { getRuntime } from '../../../lib/server/runtime'
import { withStandaloneRequest } from '../../../lib/server/standalone-request'
import { standaloneServices } from '../../../lib/server/standalone-services'

export const dynamic = 'force-dynamic'

async function scopedGET(request: NextRequest) {
  const runtime = await getRuntime()
  const selected = new URL(request.url).searchParams.get('project')
  const identity = readIdentityFromRequest(request)
  const projects = runtime.config.projects.filter(
    (project) =>
      (!selected || project.name === selected) &&
      (identity.role !== 'viewer' || identity.scopeProjects.has(project.name)),
  )
  try {
    const anomalies = (
      await Promise.all(
        projects.map(
          async (project) =>
            BackendAnomaliesResponseSchema.parse(
              await standaloneServices(runtime.config).projects.getAnomalies(project.name),
            ).anomalies,
        ),
      )
    ).flat()
    anomalies.sort((a, b) => b.detectedAt.localeCompare(a.detectedAt))
    return NextResponse.json({ anomalies })
  } catch {
    return NextResponse.json({ error: { message: 'anomaly read failed' } }, { status: 500 })
  }
}

export const GET = withStandaloneRequest(scopedGET)
