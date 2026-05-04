// CLI context loader. Resolves the precedence:
//   --project-root  >  --config  >  cwd/config.yml  >  implicit cwd
//
// Used by every CLI subcommand (and reachable from skills via the Node API).
// Skill design intent: pass --project-root and ignore everything else.

import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { ConfigError, implicitCwdProject, loadConfig } from '../config/load.js'
import { DEFAULT_POLL, type Config } from '../types.js'

export class CliContextError extends Error {
  constructor(
    public code: 'BAD_REQUEST' | 'NOT_FOUND' | 'CONFIG_ERROR',
    message: string,
  ) {
    super(message)
    this.name = 'CliContextError'
  }
}

export interface LoadCliContextInput {
  /** When set, bypasses config loading entirely; the path becomes a single anonymous project. */
  projectRoot?: string
  /** Explicit --config path. Mutually exclusive with projectRoot. */
  configPath?: string
  /** Required: process.cwd(). */
  cwd: string
}

export interface LoadCliContextResult {
  config: Config
  source: 'project-root' | 'explicit-config' | 'cwd-config' | 'implicit-cwd'
}

/**
 * Returns the resolved Config for a CLI invocation.
 *
 * Precedence:
 *   1. `projectRoot` — single anonymous project at that path; never reads any config file
 *   2. `configPath` — load that file
 *   3. `<cwd>/config.yml` if present
 *   4. Implicit cwd-as-project
 *
 * Mutual exclusion: combining `projectRoot` with `configPath` throws BAD_REQUEST.
 */
export async function loadCliContext(
  input: LoadCliContextInput,
): Promise<LoadCliContextResult> {
  if (input.projectRoot && input.configPath) {
    throw new CliContextError(
      'BAD_REQUEST',
      '--project-root cannot be combined with --config or --project',
    )
  }

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
      },
      source: 'project-root',
    }
  }

  // No --project-root: defer to existing loadConfig behavior
  try {
    const cfg = await loadConfig({ explicitPath: input.configPath, cwd: input.cwd })
    if (cfg) {
      return {
        config: cfg,
        source: input.configPath ? 'explicit-config' : 'cwd-config',
      }
    }
  } catch (err) {
    if (err instanceof ConfigError) {
      throw new CliContextError('CONFIG_ERROR', err.message)
    }
    throw err
  }

  return { config: implicitCwdProject(input.cwd), source: 'implicit-cwd' }
}
