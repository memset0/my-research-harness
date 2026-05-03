// discoverExperiments — locate experiment directories under a project root.
//
// The directory base name must match EXPERIMENT_DIR_REGEX. Parent directory
// name is irrelevant — we don't depend on `logs/` or `runs/` segments since
// the user's actual filesystem layout varies.

import fg from 'fast-glob'
import { basename } from 'node:path'
import type { ProjectConfig } from '../types.js'
import { DEFAULT_EXCLUDES, EXPERIMENT_DIR_REGEX } from '../types.js'

export interface DiscoverOptions {
  /**
   * Optional override for the experiment directory regex (testing only).
   * Production code should always use the spec-mandated default.
   */
  regex?: RegExp
}

/**
 * Returns absolute paths to all directories under `project.root` whose base
 * name matches the experiment regex, applying default + user excludes.
 */
export async function discoverExperiments(
  project: ProjectConfig,
  options: DiscoverOptions = {},
): Promise<string[]> {
  const regex = options.regex ?? EXPERIMENT_DIR_REGEX
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

  return dirs.filter((d) => regex.test(basename(d)))
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
