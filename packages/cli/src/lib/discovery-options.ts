// Process-wide Run-walk options selected by global CLI flags.
//
// The CLI has no project-level configuration source (config.yml support was
// removed), so the Project `run_dirs` declaration arrives as the repeatable
// global `--run-dir <pattern>` flag. It is validated once before any command
// action runs and then spread into every core call that walks Runs. Unset
// keeps the unbounded walk.

import { runDirPatternError } from '@memon/core'

let runDirs: string[] | undefined

/** Validate raw flag values: the pattern list, or the first error message. */
export function parseRunDirs(raw: string[] | undefined): { runDirs?: string[]; error?: string } {
  if (raw === undefined || raw.length === 0) return {}
  for (const pattern of raw) {
    const error = runDirPatternError(pattern)
    if (error !== null) return { error: `--run-dir ${error}` }
  }
  return { runDirs: [...raw] }
}

export function setRunDirs(value: string[] | undefined): void {
  runDirs = value
}

/** Options to spread into `scanProjectRoot`, `RunTargetIndex.open`, `resolveRunTarget`. */
export function runWalkOptions(): { runDirs?: string[] } {
  return runDirs === undefined ? {} : { runDirs }
}
