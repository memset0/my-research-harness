// Shared config resolution used by every non-`serve` CLI subcommand.
//
// After the cli-drop-config-yml change, the only inputs are:
//   - --project-root <path>  (explicit single-project mode)
//   - implicit cwd           (default: cwd is the single project)
//
// `memon serve` resolves config independently — see commands/serve.ts.

import { CliContextError, loadCliContext, type Config } from '@memon/core'
import { emitErrorAndExit } from './emit-error.js'

export interface ResolveOptions {
  /** `--project-root <path>` — bypasses cwd. */
  projectRoot?: string
  cwd: string
}

export async function resolveConfig(opts: ResolveOptions): Promise<Config> {
  try {
    const ctx = await loadCliContext({
      projectRoot: opts.projectRoot,
      cwd: opts.cwd,
    })
    return ctx.config
  } catch (err) {
    if (err instanceof CliContextError) {
      emitErrorAndExit(err.code, err.message)
    }
    throw err
  }
}
