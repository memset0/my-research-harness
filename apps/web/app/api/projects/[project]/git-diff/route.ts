// GET /api/projects/<project>/git-diff?path=<rel>&side=<staged|unstaged|untracked>
//
// Returns the raw old + new content for one side of the working-tree diff
// of one file. Triggered when the user expands a row in the git-diff
// dialog. Lazy: not polled, no server-side cache (TanStack handles client
// cache within a dialog session).
//
// 1024 KB cap + binary detection live in @memon/core's `readGitFileContents`.

import { resolve, sep } from 'node:path'
import { NextResponse, type NextRequest } from 'next/server'
import {
  readGitFileContents,
  type GitFileStatus,
  type ReadGitFileContentsResult,
} from '@memon/core'
import { getRuntime } from '../../../../../lib/runtime'
import { resolveSubmoduleCwd } from '../../../../../lib/server/resolve-submodule-cwd'
import { readIdentityFromRequest } from '@/lib/auth/request-context'

export const dynamic = 'force-dynamic'

type Side = 'staged' | 'unstaged' | 'untracked' | 'commit' | 'range'

const SAFE_REF_REGEX = /^[A-Za-z0-9_\-/.~^]+$/

type GitDiffResponse =
  | {
      ok: true
      filename: string
      status: GitFileStatus
      oldContent: string | null
      newContent: string | null
    }
  | { ok: false; skipReason: 'too-large'; sizeBytes: number; maxBytes: number; side: 'old' | 'new' }
  | { ok: false; skipReason: 'binary' }
  | { ok: false; error: { message: string } }

interface RouteParams {
  params: Promise<{ project: string }>
}

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: { message } }, { status: 400 })
}

function isValidSide(s: string | null): s is Side {
  return (
    s === 'staged' ||
    s === 'unstaged' ||
    s === 'untracked' ||
    s === 'commit' ||
    s === 'range'
  )
}

function pathEscapes(projectRoot: string, relPath: string): boolean {
  const absRoot = resolve(projectRoot)
  const absTarget = resolve(projectRoot, relPath)
  if (absTarget === absRoot) return false
  return !absTarget.startsWith(absRoot + sep)
}

export async function GET(req: NextRequest, ctx: RouteParams): Promise<NextResponse> {
  const { project: rawProject } = await ctx.params
  const project = decodeURIComponent(rawProject)

  const rt = await getRuntime()
  const entry = rt.config.projects.find((p) => p.name === project)
  if (!entry) {
    return NextResponse.json(
      { error: { message: 'project not found' } },
      { status: 404 },
    )
  }

  const { role, scopeProjects } = readIdentityFromRequest(req)
  if (role === 'viewer' && !scopeProjects.has(project)) {
    return NextResponse.json(
      { error: { message: 'forbidden' } },
      { status: 403 },
    )
  }

  const url = new URL(req.url)
  const submoduleParam = url.searchParams.get('submodule')
  const resolved = await resolveSubmoduleCwd(entry.root, submoduleParam)
  if (!resolved.ok) {
    return NextResponse.json(
      { error: { message: resolved.message } },
      { status: resolved.status },
    )
  }
  const cwd = resolved.cwd

  const path = url.searchParams.get('path')
  const side = url.searchParams.get('side')
  if (!path) return badRequest('missing path')
  if (path.includes('\0')) return badRequest('invalid path')
  // Path-escape check is scoped to the resolved cwd (project root for the
  // main repo, submodule root otherwise).
  if (pathEscapes(cwd, path)) return badRequest('path escapes project root')
  if (!isValidSide(side)) {
    return badRequest('side must be staged|unstaged|untracked|commit|range')
  }

  // `side=commit` requires a `sha` query param; validate against a safe-ref
  // character class before passing through to git.
  const sha = url.searchParams.get('sha')
  if (side === 'commit') {
    if (!sha) return badRequest('missing sha for side=commit')
    if (sha.length > 200 || !SAFE_REF_REGEX.test(sha)) {
      return badRequest('invalid sha')
    }
  }

  // `side=range` requires `from` AND `to`.
  const fromRef = url.searchParams.get('from')
  const toRef = url.searchParams.get('to')
  if (side === 'range') {
    if (!fromRef) return badRequest('missing from for side=range')
    if (!toRef) return badRequest('missing to for side=range')
    if (fromRef.length > 200 || !SAFE_REF_REGEX.test(fromRef)) {
      return badRequest('invalid from')
    }
    if (toRef.length > 200 || !SAFE_REF_REGEX.test(toRef)) {
      return badRequest('invalid to')
    }
  }

  // Determine old + new refs per side. The reader accepts arbitrary git refs
  // since add-git-history-dialog widened its type.
  let oldRef: string | null
  let newRef: string | null
  let defaultStatus: GitFileStatus
  switch (side) {
    case 'staged':
      oldRef = 'HEAD'
      newRef = 'index'
      defaultStatus = 'modified'
      break
    case 'unstaged':
      oldRef = 'index'
      newRef = 'working'
      defaultStatus = 'modified'
      break
    case 'untracked':
      oldRef = null
      newRef = 'working'
      defaultStatus = 'untracked'
      break
    case 'commit':
      oldRef = `${sha!}^`
      newRef = sha!
      defaultStatus = 'modified'
      break
    case 'range':
      oldRef = fromRef!
      newRef = toRef!
      defaultStatus = 'modified'
      break
  }

  const [oldRes, newRes] = await Promise.all([
    oldRef ? readGitFileContents(cwd, oldRef, path) : Promise.resolve(null),
    newRef ? readGitFileContents(cwd, newRef, path) : Promise.resolve(null),
  ])

  // Resolve old side: a `not-found` for HEAD/index means this is a new file
  // on the new side (staged-add or untracked-promoted). Treat as oldContent
  // = '' so the diff renders as all-additions, status = 'added'.
  let oldContent: string | null = null
  let status: GitFileStatus = defaultStatus
  if (oldRes) {
    if (oldRes.ok) {
      oldContent = oldRes.content
    } else if (oldRes.reason === 'not-found') {
      oldContent = ''
      status = 'added'
    } else {
      return diffSkipResponse(oldRes, 'old')
    }
  }

  // Resolve new side: a `not-found` for working means the file was deleted
  // on the new side (legitimate for `unstaged` when the user `rm`'d a
  // tracked file). Treat as newContent = '', status = 'deleted'.
  let newContent: string | null = null
  if (newRes) {
    if (newRes.ok) {
      newContent = newRes.content
    } else if (newRes.reason === 'not-found') {
      newContent = ''
      status = 'deleted'
    } else {
      return diffSkipResponse(newRes, 'new')
    }
  }

  const body: GitDiffResponse = {
    ok: true,
    filename: path,
    status,
    oldContent,
    newContent,
  }
  return NextResponse.json(body)
}

function diffSkipResponse(
  res: Extract<ReadGitFileContentsResult, { ok: false }>,
  side: 'old' | 'new',
): NextResponse {
  if (res.reason === 'too-large') {
    return NextResponse.json({
      ok: false,
      skipReason: 'too-large',
      sizeBytes: res.sizeBytes,
      maxBytes: res.maxBytes,
      side,
    } satisfies GitDiffResponse)
  }
  if (res.reason === 'binary') {
    return NextResponse.json({
      ok: false,
      skipReason: 'binary',
    } satisfies GitDiffResponse)
  }
  return NextResponse.json({
    ok: false,
    error: { message: res.reason === 'error' ? res.message : res.reason },
  } satisfies GitDiffResponse)
}
