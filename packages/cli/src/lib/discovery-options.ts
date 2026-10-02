// Process-wide Run-walk options selected by global CLI flags.
//
// The effective Run locations of an invocation follow the FS v8 chain
// `--run-dir` > `.memon/project.yml` `run_dirs` > the default
// `logs/*`, `outputs/*`, `experiments/*` (central `run_dirs` never applies to
// the CLI). The repeatable global `--run-dir <pattern>` flag is validated once
// before any command action runs and then spread into every core call that
// walks Runs. Unset passes nothing, so core reads the project declaration
// itself (an invalid declaration throws `ProjectDeclarationError`, which the
// entry point maps to `BAD_REQUEST`, exit 2).

import { type EffectiveRunDirs, resolveEffectiveRunDirs, runDirPatternError } from '@memon/core'

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

/** The `--run-dir` patterns of this invocation, when given. */
export function cliRunDirs(): string[] | undefined {
  return runDirs
}

/** Options to spread into `scanProjectRoot`, `RunTargetIndex.open`, `resolveRunTarget`. */
export function runWalkOptions(): { runDirs?: string[] } {
  return runDirs === undefined ? {} : { runDirs }
}

/** Effective Run locations of `projectRoot` for this invocation, with their source. */
export function effectiveRunDirs(projectRoot: string): Promise<EffectiveRunDirs> {
  return resolveEffectiveRunDirs({
    root: projectRoot,
    ...(runDirs === undefined ? {} : { cliRunDirs: runDirs }),
  })
}
