// Process-wide Run-walk options selected by global CLI flags.
//
// The CLI has no project-level configuration source (config.yml support was
// removed), so the Project `run_depth` bound arrives as the global
// `--run-depth <1|2>` flag. It is validated once before any command action
// runs and then spread into every core call that walks Runs. Unset keeps the
// unbounded walk.

import type { RunDepth } from '@memon/core'

let runDepth: RunDepth | undefined

/** Parse the raw flag value; `null` means invalid. */
export function parseRunDepth(raw: string | undefined): RunDepth | undefined | null {
  if (raw === undefined) return undefined
  if (raw === '1') return 1
  if (raw === '2') return 2
  return null
}

export function setRunDepth(value: RunDepth | undefined): void {
  runDepth = value
}

/** Options to spread into `scanProjectRoot`, `RunTargetIndex.open`, `resolveRunTarget`. */
export function runWalkOptions(): { runDepth?: RunDepth } {
  return runDepth === undefined ? {} : { runDepth }
}
