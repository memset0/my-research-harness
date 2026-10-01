import 'server-only'

import type { BackendProjectSummary } from '@memon/core'

export type LegacyProjectResolution =
  | { kind: 'unique'; project: BackendProjectSummary }
  | { kind: 'ambiguous'; projects: BackendProjectSummary[] }
  | { kind: 'missing' }

/** Resolve only an exact unique live Project name; never first-hit a Host. */
export function resolveLegacyProject(
  projectName: string,
  projects: readonly BackendProjectSummary[],
): LegacyProjectResolution {
  const matches = projects.filter((project) => project.project === projectName)
  if (matches.length === 0) return { kind: 'missing' }
  if (matches.length === 1) return { kind: 'unique', project: matches[0]! }
  return { kind: 'ambiguous', projects: matches }
}
