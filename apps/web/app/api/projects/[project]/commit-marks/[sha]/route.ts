// PUT|DELETE /api/projects/<project>/commit-marks/<sha>
//
// Owner-only mutations on a single mark. PUT upserts with body
// `{ status, note? }`; DELETE clears the mark (idempotent). `sha` is
// validated against the safe-ref char class before reaching the core
// writer.

import { NextResponse, type NextRequest } from 'next/server'
import {
  COMMIT_MARK_STATUSES,
  deleteCommitMark,
  setCommitMark,
  type CommitMarkStatus,
} from '@memon/core'
import { getRuntime } from '../../../../../../lib/runtime'
import { resolveSubmoduleCwd } from '../../../../../../lib/server/resolve-submodule-cwd'
import { readIdentityFromRequest } from '@/lib/auth/request-context'

export const dynamic = 'force-dynamic'

const SAFE_REF_REGEX = /^[A-Za-z0-9_\-/.~^]+$/
const MAX_SHA_LEN = 200

interface RouteParams {
  params: Promise<{ project: string; sha: string }>
}

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: { message } }, { status: 400 })
}

async function resolveAndAuthorize(
  req: NextRequest,
  ctx: RouteParams,
): Promise<
  | { ok: true; projectRoot: string; sha: string }
  | { ok: false; response: NextResponse }
> {
  const { project: rawProject, sha: rawSha } = await ctx.params
  const project = decodeURIComponent(rawProject)
  const sha = decodeURIComponent(rawSha)

  const rt = await getRuntime()
  const entry = rt.config.projects.find((p) => p.name === project)
  if (!entry) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { message: 'project not found' } },
        { status: 404 },
      ),
    }
  }

  const { role, scopeProjects } = readIdentityFromRequest(req)
  // Mutations require owner; viewers (even in-scope) are rejected with
  // 403. We check scope separately so an out-of-scope viewer never even
  // confirms the project exists.
  if (role === 'viewer') {
    if (!scopeProjects.has(project)) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: { message: 'forbidden' } },
          { status: 403 },
        ),
      }
    }
    return {
      ok: false,
      response: NextResponse.json(
        { error: { message: 'forbidden' } },
        { status: 403 },
      ),
    }
  }

  if (!sha || sha.length > MAX_SHA_LEN || !SAFE_REF_REGEX.test(sha)) {
    return { ok: false, response: badRequest('invalid sha') }
  }

  return { ok: true, projectRoot: entry.root, sha }
}

async function resolveSubmoduleFromQuery(
  req: NextRequest,
  projectRoot: string,
): Promise<{ ok: true; submodule: string } | { ok: false; response: NextResponse }> {
  const url = new URL(req.url)
  const submoduleParam = url.searchParams.get('submodule')
  const resolved = await resolveSubmoduleCwd(projectRoot, submoduleParam)
  if (!resolved.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { message: resolved.message } },
        { status: resolved.status },
      ),
    }
  }
  return { ok: true, submodule: resolved.submodule }
}

export async function PUT(req: NextRequest, ctx: RouteParams): Promise<NextResponse> {
  const auth = await resolveAndAuthorize(req, ctx)
  if (!auth.ok) return auth.response
  const sub = await resolveSubmoduleFromQuery(req, auth.projectRoot)
  if (!sub.ok) return sub.response

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return badRequest('invalid JSON body')
  }
  if (!body || typeof body !== 'object') {
    return badRequest('body must be a JSON object')
  }
  const rawStatus = (body as { status?: unknown }).status
  if (
    typeof rawStatus !== 'string' ||
    !(COMMIT_MARK_STATUSES as readonly string[]).includes(rawStatus)
  ) {
    return badRequest('status must be one of verified|suspicious|issue')
  }
  const status = rawStatus as CommitMarkStatus
  const rawNote = (body as { note?: unknown }).note
  if (rawNote !== undefined && typeof rawNote !== 'string') {
    return badRequest('note must be a string when provided')
  }
  const note: string | undefined = typeof rawNote === 'string' ? rawNote : undefined

  const mark = await setCommitMark(auth.projectRoot, auth.sha, {
    status,
    note,
    submodule: sub.submodule || undefined,
  })
  return NextResponse.json({ mark })
}

export async function DELETE(req: NextRequest, ctx: RouteParams): Promise<NextResponse> {
  const auth = await resolveAndAuthorize(req, ctx)
  if (!auth.ok) return auth.response
  const sub = await resolveSubmoduleFromQuery(req, auth.projectRoot)
  if (!sub.ok) return sub.response

  const result = await deleteCommitMark(auth.projectRoot, auth.sha, {
    submodule: sub.submodule || undefined,
  })
  return NextResponse.json(result)
}
