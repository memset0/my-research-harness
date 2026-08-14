// `memon serve [--config PATH] [--dev] [--port N]`
//
// Spawns the Next.js web app with MEMON_CONFIG_PATH set to the resolved config
// file. The web app uses that env var to know which projects/poll settings to
// load.
//
// MVP scope: only works when invoked from inside a checkout of this repo
// (because it locates the workspace's `apps/web` via pnpm-workspace.yaml).
// A future phase can bundle the web app inside the CLI package for global
// installs; for now the user runs `pnpm --filter @memon/web dev` or `memon
// serve` from the repo root.

import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CONFIG_EXAMPLE_BASENAME, isProtectedExampleConfigPath } from '@memon/core'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { emitError, emitHuman } from '../lib/output.js'

export interface ServeOptions {
  configPath?: string
  cwd: string
  dev: boolean
  port: number
}

export async function runServe(opts: ServeOptions): Promise<void> {
  const repoRoot = await findRepoRoot(opts.cwd)
  if (!repoRoot) {
    emitError(
      'memon serve requires running from inside the memon repo (looking for pnpm-workspace.yaml)',
    )
  }
  const webDir = join(repoRoot, 'apps', 'web')
  try {
    await fs.access(webDir)
  } catch {
    emitError(`apps/web not found at ${webDir}`)
  }

  // Resolve config path (absolute) so the web layer can find it
  const resolvedConfigPath = opts.configPath
    ? resolve(opts.cwd, opts.configPath)
    : await defaultConfigPath(opts.cwd, repoRoot)

  if (!resolvedConfigPath) {
    emitErrorAndExit(
      'BAD_REQUEST',
      'no instance configuration found; copy config.example.yml to config.yml or pass --config <path> to another instance file',
      { cwd: resolve(opts.cwd), repoRoot },
    )
  }

  if (isProtectedExampleConfigPath(resolvedConfigPath)) {
    emitErrorAndExit(
      'BAD_REQUEST',
      `${CONFIG_EXAMPLE_BASENAME} is a protected template and cannot be used as runtime configuration; copy it to config.yml (or another filename) first`,
      { configPath: resolvedConfigPath },
    )
  }

  emitHuman(`memon: serving with config ${resolvedConfigPath} on port ${opts.port}`)

  const child = spawn(
    'pnpm',
    ['exec', 'next', opts.dev ? 'dev' : 'start', '-p', String(opts.port)],
    {
      cwd: webDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        MEMON_CONFIG_PATH: resolvedConfigPath,
      },
    },
  )

  child.on('exit', (code) => process.exit(code ?? 0))
}

async function findRepoRoot(start: string): Promise<string | null> {
  let dir = resolve(start)
  while (true) {
    try {
      await fs.access(join(dir, 'pnpm-workspace.yaml'))
      return dir
    } catch {
      // Continue searching upward
    }
    const parent = dirname(dir)
    if (parent === dir) {
      // Also try the directory containing this CLI module (for fallback)
      const here = fileURLToPath(import.meta.url)
      const fallback = resolve(here, '..', '..', '..', '..', '..')
      try {
        await fs.access(join(fallback, 'pnpm-workspace.yaml'))
        return fallback
      } catch {
        return null
      }
    }
    dir = parent
  }
}

async function defaultConfigPath(cwd: string, repoRoot: string): Promise<string | null> {
  for (const candidate of [join(cwd, 'config.yml'), join(repoRoot, 'config.yml')]) {
    try {
      await fs.access(candidate)
      return candidate
    } catch {}
  }
  return null
}
