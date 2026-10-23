// Project addressing shared by fetchers, query keys and links. Pure and
// browser-safe: a Project is a Host-qualified ProjectRef (a plain name only
// selects API data in tests and legacy callers; it has no page route).

import type { ProjectRef } from '@memon/core'
import type { ProjectRouteTarget } from './project-routes'

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

/**
 * The Host-qualified route target of a Project. Pages exist only under
 * `/<host>/<project>`; a hostless Project has none.
 */
export function projectRouteTarget(target: ProjectTarget): ProjectRouteTarget {
  if (typeof target === 'string') {
    throw new TypeError(`Project ${target} has no Host, so it has no page route`)
  }
  return target
}
