// Resolve a configured Project for central-owned routes that name it in a
// body field or a path segment rather than through `?project=`.
//
// A Host-qualified instance may configure the same Project name under two
// Host namespaces, so an ambiguous name without a `host` selector resolves to
// nothing rather than guessing a root. A `host` this instance does not serve
// resolves to nothing as well: its files live on another machine, and no
// central route may read or execute them through a local path.

import type { Config, ProjectConfig } from '@memon/core'

export function findConfiguredProject(
  config: Config,
  projectName: string,
  host: string | null = null,
): ProjectConfig | null {
  const matches = config.projects.filter(
    (project) => project.name === projectName && (host === null || project.host === host),
  )
  return matches.length === 1 ? (matches[0] ?? null) : null
}
