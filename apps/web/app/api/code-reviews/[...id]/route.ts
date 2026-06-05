// GET   /api/code-reviews/[...id]?project=NAME
//         -> { id, scope, experiment, frontmatter, body, mtime, hash, completion }
// PATCH /api/code-reviews/[...id]?project=NAME
//         body { op: 'commit'|'todo', sha?|index?, reviewed?|done?, expectedMtime, expectedHash }
//
// `id` is the path relative to <projectRoot>/docs/ without the .md extension:
//   code-review/2026-05-24-foo
//   experiments/E0042-attn/code-review/2026-05-24-foo
// It is a catch-all segment so the slashes survive, validated against two
// strict shapes AND assertWithinProjectRoots() before any filesystem access.
// PATCH toggles a single progress flag with mtime+hash optimistic locking and
// preserves the markdown body byte-for-byte.

import { type NextRequest, NextResponse } from 'next/server'
import {
  deriveCompletion,
  formatIsoLocal,
  parseCodeReview,
  toggleCommitReviewed,
  toggleTodoDone,
} from '@memon/core'
import { getRuntime } from '../../../../lib/runtime'
import { PathSafetyError, assertWithinProjectRoots } from '../../../../lib/path-safety'

export const dynamic = 'force-dynamic'

type RT = Awaited<ReturnType<typeof getRuntime>>

// Project-wide: code-review/<date>-<slug>
// Experiment:   experiments/E<NNNN>-<slug>/code-review/<date>-<slug>
const CR_ID_RE =
  /^(code-review|experiments\/E\d{4}-[a-z0-9-]+\/code-review)\/\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*$/

function scopeOf(id: string): 'project' | 'experiment' {
  return id.startsWith('experiments/') ? 'experiment' : 'project'
}

function experimentOf(id: string): string | null {
  const m = /^experiments\/(E\d{4}-[a-z0-9-]+)\/code-review\//.exec(id)
  return m ? m[1]! : null
}

const err = (code: string, message: string, status: number) =>
  NextResponse.json({ error: { code, message } }, { status })

// Validate (project, id) and resolve to an absolute path, or return a response.
function resolveTarget(
  rt: RT,
  projectName: string | null,
  idParts: string[],
): { ok: true; id: string; path: string } | { ok: false; res: NextResponse } {
  if (!projectName) return { ok: false, res: err('BAD_REQUEST', 'project query parameter is required', 400) }
  const id = idParts.join('/')
  if (!CR_ID_RE.test(id)) return { ok: false, res: err('BAD_REQUEST', `invalid code-review id "${id}"`, 400) }
  const path = rt.codeReviewPath(projectName, id)
  if (!path) return { ok: false, res: err('NOT_FOUND', `project "${projectName}" not configured`, 404) }
  try {
    assertWithinProjectRoots(path, rt.config)
  } catch (e) {
    if (e instanceof PathSafetyError) return { ok: false, res: err('FORBIDDEN', e.message, 403) }
    throw e
  }
  return { ok: true, id, path }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string[] }> }) {
  try {
    const rt = await getRuntime()
    const projectName = new URL(req.url).searchParams.get('project')
    const { id: idParts } = await ctx.params
    const t = resolveTarget(rt, projectName, idParts)
    if (!t.ok) return t.res
    const fresh = await rt.codeReviewsCache.getContent(t.path)
    if (!fresh) return err('NOT_FOUND', `code-review "${t.id}" not found`, 404)
    let parsed
    try {
      parsed = parseCodeReview(fresh.content)
    } catch {
      return err('PARSE_ERROR', `code-review "${t.id}" has malformed frontmatter`, 422)
    }
    return NextResponse.json({
      id: t.id,
      scope: scopeOf(t.id),
      experiment: parsed.frontmatter.experiment ?? experimentOf(t.id),
      frontmatter: parsed.frontmatter,
      body: parsed.body,
      mtime: fresh.mtime,
      hash: fresh.hash,
      completion: deriveCompletion(parsed.frontmatter),
    })
  } catch (e) {
    return NextResponse.json({ error: { message: (e as Error).message } }, { status: 500 })
  }
}

interface PatchBody {
  op: 'commit' | 'todo'
  sha?: string
  index?: number
  reviewed?: boolean
  done?: boolean
  expectedMtime: number
  expectedHash: string
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string[] }> }) {
  try {
    const rt = await getRuntime()
    const projectName = new URL(req.url).searchParams.get('project')
    const { id: idParts } = await ctx.params
    const t = resolveTarget(rt, projectName, idParts)
    if (!t.ok) return t.res

    const body = (await req.json()) as PatchBody
    if (typeof body.expectedMtime !== 'number' || typeof body.expectedHash !== 'string') {
      return err('BAD_REQUEST', 'expectedMtime (number) and expectedHash (string) required', 400)
    }

    const fresh = await rt.codeReviewsCache.getContent(t.path)
    if (!fresh) return err('NOT_FOUND', `code-review "${t.id}" not found`, 404)
    if (fresh.mtime !== body.expectedMtime || fresh.hash !== body.expectedHash) {
      return NextResponse.json(
        {
          error: { code: 'CONFLICT', message: 'on-disk content has changed since read' },
          currentMtime: fresh.mtime,
          currentHash: fresh.hash,
        },
        { status: 409 },
      )
    }

    const now = formatIsoLocal(new Date())
    let next: string | null
    if (body.op === 'commit') {
      if (typeof body.sha !== 'string' || typeof body.reviewed !== 'boolean') {
        return err('BAD_REQUEST', "op 'commit' requires sha (string) and reviewed (boolean)", 400)
      }
      next = toggleCommitReviewed(fresh.content, body.sha, body.reviewed, now)
      if (next === null) return err('BAD_REQUEST', `commit sha "${body.sha}" not found`, 400)
    } else if (body.op === 'todo') {
      if (typeof body.index !== 'number' || typeof body.done !== 'boolean') {
        return err('BAD_REQUEST', "op 'todo' requires index (number) and done (boolean)", 400)
      }
      next = toggleTodoDone(fresh.content, body.index, body.done, now)
      if (next === null) return err('BAD_REQUEST', `todo index ${body.index} out of range`, 400)
    } else {
      return err('BAD_REQUEST', "op must be 'commit' or 'todo'", 400)
    }

    const result = await rt.codeReviewsCache.putContent(
      t.path,
      next,
      body.expectedMtime,
      body.expectedHash,
    )
    if (result.ok) {
      const completion = deriveCompletion(parseCodeReview(next).frontmatter)
      return NextResponse.json({ ok: true, mtime: result.mtime, hash: result.hash, completion })
    }
    if (result.code === 'CONFLICT') {
      return NextResponse.json(
        {
          error: { code: 'CONFLICT', message: 'on-disk content has changed since read' },
          currentMtime: result.currentMtime,
          currentHash: result.currentHash,
        },
        { status: 409 },
      )
    }
    if (result.code === 'NOT_FOUND') return err('NOT_FOUND', 'file disappeared during write', 404)
    return NextResponse.json({ error: { message: result.message ?? 'write failed' } }, { status: 500 })
  } catch (e) {
    return NextResponse.json({ error: { message: (e as Error).message } }, { status: 500 })
  }
}
