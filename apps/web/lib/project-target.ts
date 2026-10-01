// Project addressing shared by fetchers, query keys and links. Pure and
// browser-safe: a Project is either a plain standalone Project name or a
// Host-qualified ProjectRef in central mode.

import type { ProjectRef } from '@memon/core'

export type ProjectTarget = string | ProjectRef

export function projectName(target: ProjectTarget): string {
  return typeof target === 'string' ? target : target.project
}

export function projectHost(target: ProjectTarget): string | null {
  return typeof target === 'string' ? null : target.host
}

export function projectSearchParams(target: ProjectTarget): URLSearchParams {
  const params = new URLSearchParams()
  const host = projectHost(target)
  if (host) params.set('host', host)
  params.set('project', projectName(target))
  return params
}

export function projectQueryKey(
  target: ProjectTarget,
): readonly [project: string] | readonly [host: string, project: string] {
  const host = projectHost(target)
  return host ? ([host, projectName(target)] as const) : ([projectName(target)] as const)
}

/** Canonical browser path for a standalone or Host-qualified Project. */
export function projectWebPath(target: ProjectTarget, suffix = ''): string {
  if (suffix !== '' && !suffix.startsWith('/')) {
    throw new Error('Project path suffix must be empty or start with /')
  }
  const project = encodeURIComponent(projectName(target))
  const host = projectHost(target)
  const base = host ? `/h/${encodeURIComponent(host)}/p/${project}` : `/p/${project}`
  return `${base}${suffix}`
}
