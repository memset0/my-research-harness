import { NextResponse, type NextRequest } from 'next/server'
import { getRuntime } from '../../../lib/runtime'
import { readIdentityFromRequest } from '@/lib/auth/request-context'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const rt = await getRuntime()
    const { role, scopeProjects } = readIdentityFromRequest(req)
    const filtered =
      role === 'viewer'
        ? rt.config.projects.filter((p) => scopeProjects.has(p.name))
        : rt.config.projects
    return NextResponse.json({
      projects: filtered.map((p) => ({
        name: p.name,
        root: p.root,
        exclude: p.exclude,
      })),
    })
  } catch (err) {
    return NextResponse.json(
      { error: { message: (err as Error).message } },
      { status: 500 },
    )
  }
}
