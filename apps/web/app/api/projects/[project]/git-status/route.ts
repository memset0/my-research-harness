// GET /api/projects/<project>/git-status — git working-tree status.
//
// Resolves the project segment against the runtime's `config.projects`
// registry; rejects unknown names with 404 and viewer-out-of-scope requests
// with 403. Calls @memon/core's `readGitStatus(project.root)`, which shells
// out to `git status --porcelain=v2 --branch --ignore-submodules=all`.
//
// An in-memory throttle (1s window) shields the underlying git process from
// HMR reload storms and parallel tabs.

import { BackendGitStatusResponseSchema } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import {
  gitServiceError,
  standaloneGitContext,
} from '../../../../../lib/server/standalone-git-route'

export const dynamic = 'force-dynamic'

interface CacheEntry {
  readAt: number
  result: ReturnType<typeof BackendGitStatusResponseSchema.parse>
}

const cache = new Map<string, CacheEntry>()

interface RouteParams {
  params: Promise<{ project: string }>
}

export async function GET(req: NextRequest, ctx: RouteParams): Promise<NextResponse> {
  const { project: rawProject } = await ctx.params
  const context = await standaloneGitContext(req, rawProject)
  if (context instanceof NextResponse) return context

  // Throttle window equals the configured polling interval — see
  // `git_status` capability spec ("git_status config block" requirement).
  const now = Date.now()
  const cached = cache.get(context.project)
  if (cached && now - cached.readAt < context.gitStatusIntervalMs) {
    return NextResponse.json(cached.result)
  }
  try {
    const result = BackendGitStatusResponseSchema.parse(await context.git.status(context.project))
    cache.set(context.project, { readAt: now, result })
    return NextResponse.json(result)
  } catch (error) {
    return gitServiceError(error)
  }
}

/** Test-only hook — vitest mocks rely on a clean throttle cache. */
export function __resetGitStatusCacheForTests(): void {
  cache.clear()
}
