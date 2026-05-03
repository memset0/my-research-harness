// `memon mock seed [--force]`
//
// Copies the in-repo `mock/` directory to a writable runtime location so users
// can mutate the data without polluting git-tracked fixtures. Re-running
// `seed` requires `--force` if the destination already exists.

import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { emitError, emitHuman, emitJson, type OutputFormat } from '../lib/output.js'

export interface MockSeedOptions {
  force: boolean
  cwd: string
  format: OutputFormat
  /** Override default destination (test-only). */
  dest?: string
  /** Override default source (test-only). */
  source?: string
}

const DEFAULT_DEST_REL = 'mock-runtime'
const DEFAULT_SOURCE_REL = 'mock'

export async function runMockSeed(opts: MockSeedOptions): Promise<void> {
  const source = opts.source ?? resolve(opts.cwd, DEFAULT_SOURCE_REL)
  const dest = opts.dest ?? resolve(opts.cwd, DEFAULT_DEST_REL)

  try {
    await fs.access(source)
  } catch {
    emitError(`mock source not found: ${source}`)
  }

  let destExists = false
  try {
    await fs.access(dest)
    destExists = true
  } catch {
    // OK — will be created
  }

  if (destExists && !opts.force) {
    emitError(`destination already exists: ${dest} (use --force to overwrite)`, 2)
  }

  if (destExists) {
    await fs.rm(dest, { recursive: true, force: true })
  }

  await copyDir(source, dest)

  if (opts.format === 'json') {
    emitJson({ seeded: { source, dest } })
  } else {
    emitHuman(`seeded ${dest} (from ${source})`)
  }
}

async function copyDir(src: string, dst: string): Promise<void> {
  await fs.mkdir(dst, { recursive: true })
  const entries = await fs.readdir(src, { withFileTypes: true })
  await Promise.all(
    entries.map(async (e) => {
      const srcPath = join(src, e.name)
      const dstPath = join(dst, e.name)
      if (e.isDirectory()) {
        await copyDir(srcPath, dstPath)
      } else if (e.isSymbolicLink()) {
        const target = await fs.readlink(srcPath)
        await fs.symlink(target, dstPath)
      } else {
        await fs.copyFile(srcPath, dstPath)
      }
    }),
  )
}
