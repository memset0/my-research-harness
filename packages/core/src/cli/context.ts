// CLI context loader. Resolves the precedence:
//   --project-root  >  implicit cwd
//
// Used by every non-`serve` CLI subcommand (and reachable from skills via
// the Node API). `memon serve` handles its own `--config` resolution via
// `loadConfig` directly — see packages/cli/src/commands/serve.ts.
//
// Skill design intent: pass --project-root and ignore everything else.

import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { implicitCwdProject } from '../config/load.js'
import { DEFAULT_GIT_STATUS, DEFAULT_POLL, DEFAULT_SLURM, DEFAULT_TERMINAL, type Config } from '../types.js'

export class CliContextError extends Error {
  constructor(
    public code: 'BAD_REQUEST' | 'NOT_FOUND',
    message: string,
  ) {
    super(message)
    this.name = 'CliContextError'
  }
}

export interface LoadCliContextInput {
  /** When set, treats this path as a single anonymous project. */
  projectRoot?: string
  /** Required: process.cwd(). */
  cwd: string
}

export interface LoadCliContextResult {
  config: Config
  source: 'project-root' | 'implicit-cwd'
}

/**
 * Returns the resolved Config for a CLI invocation.
 *
 * Precedence:
 *   1. `projectRoot` — single anonymous project at that path
 *   2. Implicit `cwd` — single anonymous project at the working directory
 *
 * No `config.yml` file is read; that's a `memon serve` (web) concern.
 */
export async function loadCliContext(
  input: LoadCliContextInput,
): Promise<LoadCliContextResult> {
  if (input.projectRoot) {
    const abs = resolve(input.projectRoot)
    if (!existsSync(abs)) {
      throw new CliContextError(
        'NOT_FOUND',
        `project root does not exist: ${abs}`,
      )
    }
    if (!statSync(abs).isDirectory()) {
      throw new CliContextError(
        'NOT_FOUND',
        `project root is not a directory: ${abs}`,
      )
    }
    return {
      config: {
        projects: [{ name: '(project-root)', root: abs, include: [], exclude: [] }],
        poll: { ...DEFAULT_POLL },
        terminal: { ...DEFAULT_TERMINAL },
        slurm: { ...DEFAULT_SLURM },
        gitStatus: { ...DEFAULT_GIT_STATUS },
      },
      source: 'project-root',
    }
  }

  return { config: implicitCwdProject(input.cwd), source: 'implicit-cwd' }
}
