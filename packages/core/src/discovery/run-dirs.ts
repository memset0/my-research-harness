// `run_dirs` — declared Run directory locations (`bounded-run-discovery`).
//
// A Project may list project-relative directory patterns saying where its Run
// directories live, e.g. `["logs/*", "outputs/*/*"]`. Patterns are split on
// `/`; each segment is a literal or a glob using `*` / `?` within the
// segment. `**` is forbidden (it would reintroduce the unbounded walk), as
// are `.` / `..` segments, absolute paths and backslashes. The first segment
// must be a literal Run root (`logs`, `outputs`, `experiments`) so every
// discovered Run stays a valid project-relative Run path.

import { RUN_ROOT_DIRECTORIES } from '../ids.js'

/** Lint-level code for a pattern match whose name is not Run-shaped. */
export const RUN_DIR_PATTERN_NON_RUN = 'RUN_DIR_PATTERN_NON_RUN'

/** Why `pattern` is not a valid `run_dirs` entry, or null when it is. */
export function runDirPatternError(pattern: string): string | null {
  if (typeof pattern !== 'string' || pattern.length === 0) return 'must be a non-empty pattern'
  if (/[\\\0]/.test(pattern)) return `"${pattern}" must not contain backslashes or NUL`
  if (pattern.startsWith('/')) return `"${pattern}" must be relative to the project root`
  const segments = pattern.split('/')
  if (segments.some((segment) => segment.length === 0))
    return `"${pattern}" must not contain empty segments`
  if (segments.some((segment) => segment === '.' || segment === '..'))
    return `"${pattern}" must not contain "." or ".." segments`
  if (segments.some((segment) => segment.includes('**')))
    return `"${pattern}" must not use "**"; spell out each level with "*"`
  if (segments.length < 2) return `"${pattern}" must name directories below a Run root`
  if (!(RUN_ROOT_DIRECTORIES as readonly string[]).includes(segments[0]!))
    return `"${pattern}" must start with ${RUN_ROOT_DIRECTORIES.join(', ')}`
  return null
}

/** True when a segment contains glob characters. */
export function isGlobSegment(segment: string): boolean {
  return segment.includes('*') || segment.includes('?')
}

/** Compile one pattern segment (`*`, `?`, literals) into an anchored RegExp. */
export function segmentMatcher(segment: string): RegExp {
  let source = '^'
  for (const character of segment) {
    if (character === '*') source += '[^/]*'
    else if (character === '?') source += '[^/]'
    else source += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`${source}$`)
}
