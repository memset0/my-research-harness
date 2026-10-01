// POST /api/components/run
//
// Recompute the executable component blocks of one document and rewrite their
// cache files under `<dir>/<stem>__assets/`.
//
// Owner-only, and deliberately NOT gated by the Project's `read_only` flag:
// the cache files are derived artifacts of the document the operator asked to
// recompute, in the same trust class as `bash <entry>` — a read-only *data*
// policy does not apply. Execution needs the Project's own files and
// interpreter on this machine, so only a `local` execution provider
// qualifies; every other provider (and every Host this instance does not
// serve from its own filesystem) is refused with 409.

import { ComponentRunError, runDocumentComponents } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { readIdentityFromRequest } from '../../../../lib/server/auth/request-context'
import { findConfiguredProject } from '../../../../lib/server/project-lookup'
import { getRuntime } from '../../../../lib/server/runtime'

export const dynamic = 'force-dynamic'

const HEADERS = { 'Cache-Control': 'no-store' }

const RunRequestSchema = z
  .object({
    project: z.string().min(1).max(256),
    host: z.string().min(1).max(256).optional(),
    document: z.string().min(1).max(4096),
    ids: z.array(z.string().min(1).max(256)).max(256).optional(),
  })
  .strict()

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (readIdentityFromRequest(request).role !== 'owner') {
    return error(403, 'FORBIDDEN', 'component execution is owner-only')
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return error(400, 'BAD_REQUEST', 'invalid JSON body')
  }
  const parsed = RunRequestSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const field = issue?.path.join('.')
    return error(
      400,
      'BAD_REQUEST',
      issue ? `${field || 'body'}: ${issue.message}` : 'invalid body',
    )
  }
  const body = parsed.data
  // The runtime resolves the document against the Project root, but a path
  // that is not project-relative never reaches the filesystem.
  if (
    body.document.startsWith('/') ||
    body.document.includes('\\') ||
    body.document.includes('\0') ||
    body.document.split('/').some((segment) => segment === '..')
  ) {
    return error(400, 'BAD_REQUEST', 'document must be a project-relative path')
  }

  const runtime = await getRuntime()
  const project = findConfiguredProject(runtime.config, body.project, body.host ?? null)
  if (!project) {
    if (body.host !== undefined) {
      return error(
        409,
        'EXECUTION_UNAVAILABLE',
        `components run on the instance that owns the document; host ${body.host} is not served here`,
      )
    }
    return error(400, 'BAD_REQUEST', `unknown project ${body.project}`)
  }
  const execution = project.execution
  if (execution?.kind !== 'local') {
    return error(
      409,
      'EXECUTION_UNAVAILABLE',
      `project ${body.project} has no local execution provider; run \`memon components run ${body.document}\` on the machine that owns it`,
    )
  }

  try {
    const results = await runDocumentComponents({
      root: project.root,
      documentPath: body.document,
      ...(execution.python === undefined ? {} : { pythonCommand: execution.python }),
      ...(execution.component_timeout_ms === undefined
        ? {}
        : { timeoutMs: execution.component_timeout_ms }),
      ...(body.ids === undefined ? {} : { ids: body.ids }),
    })
    return NextResponse.json({ results }, { headers: HEADERS })
  } catch (caught) {
    if (caught instanceof ComponentRunError) {
      return error(400, caught.code, caught.message)
    }
    throw caught
  }
}

function error(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status, headers: HEADERS })
}
