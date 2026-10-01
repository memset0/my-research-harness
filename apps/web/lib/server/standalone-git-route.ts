import 'server-only'

import { BackendGitServiceError, type FilesystemGitService } from '@memon/backend'
import type { Config } from '@memon/core'
import { NextResponse } from 'next/server'
import { readIdentityFromRequest } from './auth/request-context'
import { getRuntime } from './runtime'
import { standaloneServices } from './standalone-services'

export interface StandaloneGitContext {
  project: string
  git: FilesystemGitService
  gitStatusIntervalMs: number
  config: Config
}

export async function standaloneGitContext(
  request: Request,
  rawProject: string | null | undefined,
  routeClass: 'read' | 'mutating' = 'read',
): Promise<StandaloneGitContext | NextResponse> {
  if (!rawProject) return gitError(400, 'project query parameter is required')
  let project: string
  try {
    project = decodeURIComponent(rawProject)
  } catch {
    return gitError(400, 'project selector is invalid')
  }
  const runtime = await getRuntime()
  if (!runtime.config.projects.some((candidate) => candidate.name === project)) {
    return gitError(404, 'project not found')
  }
  const identity = readIdentityFromRequest(request)
  if (
    identity.role === 'viewer' &&
    (routeClass === 'mutating' || !identity.scopeProjects.has(project))
  ) {
    return gitError(403, 'forbidden')
  }
  return {
    project,
    git: standaloneServices(runtime.config).git,
    gitStatusIntervalMs: runtime.config.gitStatus?.intervalMs ?? 1000,
    config: runtime.config,
  }
}

export function gitServiceError(error: unknown): NextResponse {
  if (error instanceof BackendGitServiceError) {
    return gitError(
      error.code === 'PROJECT_NOT_FOUND' || error.code === 'RESOURCE_NOT_FOUND' ? 404 : 400,
      error.message,
    )
  }
  return gitError(500, 'Git operation failed')
}

export function gitError(status: number, message: string): NextResponse {
  return NextResponse.json({ error: { message } }, { status })
}
