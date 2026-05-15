// GET /api/projects/<project>/git-status — git working-tree status.
//
// Resolves the project segment against the runtime's `config.projects`
// registry; rejects unknown names with 404 and viewer-out-of-scope requests
// with 403. Calls @memon/core's `readGitStatus(project.root)`, which shells
// out to `git status --porcelain=v2 --branch --ignore-submodules=all`.
//
// An in-memory throttle (1s window) shields the underlying git process from
// HMR reload storms and parallel tabs.

import { NextResponse, type NextRequest } from 'next/server'
import { readGitStatus, type GitStatus } from '@memon/core'
import { getRuntime } from '../../../../../lib/runtime'
import { readIdentityFromRequest } from '@/lib/auth/request-context'

export const dynamic = 'force-dynamic'

interface CacheEntry {
  readAt: number
  result: GitStatus
}

const cache = new Map<string, CacheEntry>()

interface RouteParams {
  params: Promise<{ project: string }>
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

  // Throttle window equals the configured polling interval — see
  // `git_status` capability spec ("git_status config block" requirement).
  const throttleMs = rt.config.gitStatus.intervalMs
  const now = Date.now()
  const cached = cache.get(project)
  if (cached && now - cached.readAt < throttleMs) {
    return NextResponse.json(cached.result)
  }

  const result = await readGitStatus(entry.root)
  cache.set(project, { readAt: now, result })
  return NextResponse.json(result)
}

/** Test-only hook — vitest mocks rely on a clean throttle cache. */
export function __resetGitStatusCacheForTests(): void {
  cache.clear()
}
