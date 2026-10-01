// GET|PUT /api/readme — legacy absolute-path adapter over shared document/mutation services.

import { basename, dirname } from 'node:path'
import { BackendMutationError } from '@memon/backend'
import { BackendReadmeResponseSchema } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import type { PathReadmeResponse, PutReadmeResponse } from '@/lib/dto/documents'
import { PathSafetyError } from '../../../lib/server/path-safety'
import { getRuntime } from '../../../lib/server/runtime'
import { standaloneResource } from '../../../lib/server/standalone-resource'
import { standaloneServices } from '../../../lib/server/standalone-services'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const path = new URL(request.url).searchParams.get('path')
  if (!path) return badRequest('path query parameter required')
  try {
    const runtime = await getRuntime()
    const target = standaloneResource(runtime.config, path)
    const readme = BackendReadmeResponseSchema.parse(
      await standaloneServices(runtime.config).documents.getReadme(
        target.project.name,
        target.resource,
      ),
    )
    return NextResponse.json({
      path: target.safePath,
      content: readme.content,
      mtime: readme.mtime,
      hash: readme.hash,
    } satisfies PathReadmeResponse)
  } catch (error) {
    return readmeError(error)
  }
}

export async function PUT(request: NextRequest) {
  let body: { path?: unknown; content?: unknown; expectedMtime?: unknown; expectedHash?: unknown }
  try {
    body = await request.json()
  } catch {
    return badRequest('invalid JSON body')
  }
  if (
    typeof body.path !== 'string' ||
    typeof body.content !== 'string' ||
    typeof body.expectedMtime !== 'number'
  ) {
    return badRequest('path, content, expectedMtime required')
  }
  try {
    const runtime = await getRuntime()
    const target = standaloneResource(runtime.config, body.path)
    const services = standaloneServices(runtime.config)
    const current = BackendReadmeResponseSchema.parse(
      await services.documents.getReadme(target.project.name, target.resource),
    )
    const expectedHash = typeof body.expectedHash === 'string' ? body.expectedHash : current.hash
    const runId = target.resource.endsWith('/README.md') ? basename(dirname(target.resource)) : null
    const experimentMatch =
      /(?:^|\/)docs\/experiments\/(E\d{4}-[a-z0-9-]+)(?:\/README\.md|\.md)$/.exec(target.resource)
    const result = experimentMatch?.[1]
      ? await services.mutations.writeExperimentReadme(target.project.name, experimentMatch[1], {
          content: body.content,
          expectedMtime: body.expectedMtime,
          expectedHash,
        })
      : runId
        ? await services.mutations.writeRunReadme(target.project.name, runId, {
            content: body.content,
            expectedMtime: body.expectedMtime,
            expectedHash,
          })
        : null
    if (!result) return badRequest('path is not a Run or Experiment README')
    runtime.pokeByPath(dirname(target.safePath))
    return NextResponse.json({
      mtime: result.mtime,
      hash: result.hash,
      finalContent: result.finalContent,
    } satisfies PutReadmeResponse)
  } catch (error) {
    if (error instanceof BackendMutationError && error.code === 'CONFLICT') {
      return NextResponse.json(
        {
          error: { code: 'CONFLICT', message: error.message },
          mtime: error.current?.mtime,
          content: error.current?.content,
        },
        { status: 409 },
      )
    }
    return readmeError(error)
  }
}

function badRequest(message: string) {
  return NextResponse.json({ error: { code: 'BAD_REQUEST', message } }, { status: 400 })
}

function readmeError(error: unknown) {
  if (error instanceof PathSafetyError) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: error.message } },
      { status: 403 },
    )
  }
  if (error instanceof BackendMutationError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.code === 'FORBIDDEN' ? 403 : 404 },
    )
  }
  return NextResponse.json({ error: { message: 'README operation failed' } }, { status: 500 })
}
