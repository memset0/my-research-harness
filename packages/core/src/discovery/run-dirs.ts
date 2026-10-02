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

/**
 * FS v8 default Run locations, used when no source declares `run_dirs`
 * (no CLI `--run-dir`, no central `run_dirs`, no `.memon/project.yml`
 * `run_dirs`): one level below each Run root, never deeper.
 */
export const DEFAULT_RUN_DIRS: readonly string[] = Object.freeze([
  'logs/*',
  'outputs/*',
  'experiments/*',
])

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

const RUN_SHAPED_SEGMENT = /^.+-\d{6}-\d{6}$/

/**
 * True when the project-relative Run path `path` is discovered by one of
 * `patterns`: same number of segments, every segment matched, and no
 * intermediate segment that discovery would never use as a prefix (a dot
 * name or a Run-shaped name). Excludes are not considered.
 */
export function matchesRunDirPatterns(path: string, patterns: readonly string[]): boolean {
  const segments = path.split('/')
  return patterns.some((pattern) => {
    const parts = pattern.split('/')
    if (parts.length !== segments.length) return false
    return parts.every((part, index) => {
      const segment = segments[index]!
      if (segment.startsWith('.')) return false
      if (index < parts.length - 1 && RUN_SHAPED_SEGMENT.test(segment)) return false
      return isGlobSegment(part) ? segmentMatcher(part).test(segment) : part === segment
    })
  })
}

/**
 * The first Run-shaped ancestor segment of a project-relative Run path, or
 * null when the path does not nest inside another Run (`RUN_NESTED`).
 */
export function nestedRunAncestor(path: string): string | null {
  const segments = path.split('/')
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (RUN_SHAPED_SEGMENT.test(segments[index]!)) return segments.slice(0, index + 1).join('/')
  }
  return null
}
