import { promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { isProtectedExampleConfigPath } from '@memon/core'

export interface ResolveRuntimeConfigPathOptions {
  cwd: string
  explicitPath?: string
}

/**
 * Resolve the instance configuration used by the direct web runtime.
 *
 * This function only performs read-only path discovery. In particular, the
 * committed config.example.yml template is neither selected implicitly nor
 * accepted explicitly, so later runtime initialization can only persist into
 * an operator-owned instance configuration.
 */
export async function resolveRuntimeConfigPath({
  cwd,
  explicitPath,
}: ResolveRuntimeConfigPathOptions): Promise<string | null> {
  if (explicitPath) {
    const candidate = resolve(cwd, explicitPath)
    if (isProtectedExampleConfigPath(candidate)) {
      throw new Error(
        'memon: config.example.yml is a protected template, not a runtime configuration. ' +
          'Copy it to config.yml or set MEMON_CONFIG_PATH to another instance file.',
      )
    }
    return candidate
  }

  // Walk up from cwd looking for pnpm-workspace.yaml (= repo root). The
  // example template is intentionally not a fallback: a runtime instance must
  // be selected deliberately.
  let directory = resolve(cwd)
  while (true) {
    try {
      await fs.access(join(directory, 'pnpm-workspace.yaml'))
      const candidate = join(directory, 'config.yml')
      try {
        await fs.access(candidate)
        return candidate
      } catch {
        return null
      }
    } catch {
      // Continue walking upward.
    }

    const parent = dirname(directory)
    if (parent === directory) return null
    directory = parent
  }
}
