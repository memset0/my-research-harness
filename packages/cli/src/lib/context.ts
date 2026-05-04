// Resolve a CLI invocation's project context from common flag set.
//
// Skills always pass `--project-root .`. Existing memon users may rely on
// `--config` or implicit cwd config.yml — those still work.

import {
  CliContextError,
  loadCliContext,
  type Config,
  type LoadCliContextResult,
} from '@memon/core'
import { emitErrorAndExit } from './emit-error.js'

export interface CliFlags {
  projectRoot?: string
  configPath?: string
  cwd: string
  /** Optional `--project NAME` (only meaningful when not using --project-root). */
  project?: string
}

export async function resolveContext(
  flags: CliFlags,
): Promise<LoadCliContextResult> {
  if (flags.projectRoot && (flags.configPath || flags.project)) {
    emitErrorAndExit(
      'BAD_REQUEST',
      '--project-root cannot be combined with --config or --project',
    )
  }
  try {
    return await loadCliContext({
      projectRoot: flags.projectRoot,
      configPath: flags.configPath,
      cwd: flags.cwd,
    })
  } catch (err) {
    if (err instanceof CliContextError) {
      emitErrorAndExit(err.code === 'CONFIG_ERROR' ? 'BAD_REQUEST' : err.code, err.message)
    }
    throw err
  }
}

export function singleProjectRoot(ctx: LoadCliContextResult): string {
  if (ctx.config.projects.length === 0) {
    emitErrorAndExit('NOT_FOUND', 'no projects in resolved config')
  }
  if (ctx.config.projects.length > 1) {
    emitErrorAndExit(
      'BAD_REQUEST',
      'multiple projects in config; pick one with --project NAME or use --project-root',
    )
  }
  return ctx.config.projects[0]!.root
}

/** Pick a project by name from the resolved config; error if missing. */
export function projectByName(
  ctx: LoadCliContextResult,
  name: string,
): Config['projects'][number] {
  const found = ctx.config.projects.find((p) => p.name === name)
  if (!found) {
    emitErrorAndExit('NOT_FOUND', `project "${name}" not found in config`)
  }
  return found
}
