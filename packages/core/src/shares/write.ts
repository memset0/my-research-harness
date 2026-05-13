import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { resolveSharesFilePath } from './paths.js'
import type { SharesFile } from './types.js'

/**
 * Atomically write `<projectRoot>/.memon/shares.json`. Creates the `.memon/`
 * directory if needed. Atomic = write to a temp file in the same directory,
 * then rename. A crash mid-write leaves either the previous content or no
 * marker, never a half-written file.
 *
 * Mirrors `fs-version/write.ts`.
 */
export async function writeShares(projectRoot: string, file: SharesFile): Promise<void> {
  if (file.version !== 1) {
    throw new Error(`writeShares: file.version must be 1, got ${String(file.version)}`)
  }
  const { sharesAbs } = resolveSharesFilePath(projectRoot)
  const dir = dirname(sharesAbs)
  await fs.mkdir(dir, { recursive: true })

  const serialised = `${JSON.stringify(file, null, 2)}\n`
  const tmpAbs = `${sharesAbs}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
  await fs.writeFile(tmpAbs, serialised, { mode: 0o644 })
  try {
    await fs.rename(tmpAbs, sharesAbs)
  } catch (err) {
    await fs.rm(tmpAbs, { force: true }).catch(() => {})
    throw err
  }
}
