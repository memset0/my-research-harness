// discoverRuns — locate experiment directories under a project root.
//
// The directory base name must match RUN_DIR_REGEX. Parent directory
// name is irrelevant — we don't depend on `logs/` or `runs/` segments since
// the user's actual filesystem layout varies.

import fg from 'fast-glob'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { ProjectConfig } from '../types.js'
import { DEFAULT_EXCLUDES, RUN_DIR_REGEX } from '../types.js'

/** Sidecar file name that marks a run directory as archived. */
export const ARCHIVED_SIDECAR = '.archived'

export interface DiscoverOptions {
  /**
   * Optional override for the experiment directory regex (testing only).
   * Production code should always use the spec-mandated default.
   */
  regex?: RegExp
  /**
   * Include directories that contain the `.archived` sidecar. Default `false`
   * — archived runs are hidden from `list`, `scan`, the web sidebar, etc.
   */
  includeArchived?: boolean
}

/**
 * Returns absolute paths to all directories under `project.root` whose base
 * name matches the experiment regex, applying default + user excludes. By
 * default, runs marked archived (i.e., contain a `.archived` sidecar file)
 * are filtered out.
 */
export async function discoverRuns(
  project: ProjectConfig,
  options: DiscoverOptions = {},
): Promise<string[]> {
  const regex = options.regex ?? RUN_DIR_REGEX
  const includeArchived = options.includeArchived ?? false
  const include = project.include.length > 0 ? project.include : ['**/*']
  const excludes = mergeExcludes(project.exclude)
  const ignore = excludes.flatMap((e) => [`**/${e}`, `**/${e}/**`])

  const dirs = await fg(include, {
    cwd: project.root,
    onlyDirectories: true,
    ignore,
    absolute: true,
    dot: false,
    suppressErrors: true,
  })

  const matched = dirs.filter((d) => regex.test(basename(d)))
  if (includeArchived) return matched
  return matched.filter((d) => !isArchived(d))
}

/** True when the given run directory contains a `.archived` sidecar. */
export function isArchived(runDir: string): boolean {
  return existsSync(join(runDir, ARCHIVED_SIDECAR))
}

/**
 * Merge project-level user excludes with the spec-mandated defaults.
 * Order: defaults first, then user (deduped).
 */
export function mergeExcludes(userExcludes: ReadonlyArray<string>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const e of [...DEFAULT_EXCLUDES, ...userExcludes]) {
    if (!seen.has(e)) {
      seen.add(e)
      out.push(e)
    }
  }
  return out
}
