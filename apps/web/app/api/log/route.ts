// GET /api/log — legacy absolute-path adapter over the shared log service.

import { BackendStreamServiceError } from '@memon/backend'
import { type NextRequest, NextResponse } from 'next/server'
import { PathSafetyError } from '../../../lib/path-safety'
import { getRuntime } from '../../../lib/runtime'
import { standaloneResource } from '../../../lib/server/standalone-resource'
import { standaloneServices } from '../../../lib/server/standalone-services'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const search = new URL(request.url).searchParams
  const path = search.get('path')
  if (!path) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'path query parameter required' } },
      { status: 400 },
    )
  }
  try {
    const runtime = await getRuntime()
    const target = standaloneResource(runtime.config, path)
    return NextResponse.json(
      await standaloneServices(runtime.config).streaming.readLogLines(
        target.project.name,
        target.resource,
        {
          ...(search.get('endLine') ? { endLine: Number(search.get('endLine')) } : {}),
          ...(search.get('count') ? { count: Number(search.get('count')) } : {}),
        },
      ),
    )
  } catch (error) {
    if (error instanceof PathSafetyError) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: error.message } },
        { status: 403 },
      )
    }
    if (error instanceof BackendStreamServiceError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.code === 'INVALID_RESOURCE' ? 400 : 404 },
      )
    }
    return NextResponse.json({ error: { message: 'log read failed' } }, { status: 500 })
  }
}
