// GET /api/log-files — legacy absolute-directory adapter over shared log discovery.

import { join } from 'node:path'
import { BackendStreamServiceError } from '@memon/backend'
import { BackendLogFilesResponseSchema } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import { PathSafetyError } from '../../../lib/path-safety'
import { getRuntime } from '../../../lib/runtime'
import { standaloneResource } from '../../../lib/server/standalone-resource'
import { standaloneServices } from '../../../lib/server/standalone-services'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const expPath = new URL(request.url).searchParams.get('expPath')
  if (!expPath) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'expPath query parameter required' } },
      { status: 400 },
    )
  }
  try {
    const runtime = await getRuntime()
    const target = standaloneResource(runtime.config, join(expPath, 'README.md'))
    const payload = BackendLogFilesResponseSchema.parse(
      await standaloneServices(runtime.config).streaming.listLogFiles(
        target.project.name,
        target.resource,
      ),
    )
    return NextResponse.json({
      files: payload.files.map(({ resource, ...file }) => ({
        ...file,
        path: join(target.project.root, resource),
      })),
    })
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
    return NextResponse.json({ error: { message: 'log discovery failed' } }, { status: 500 })
  }
}
