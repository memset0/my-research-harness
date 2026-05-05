import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { resolveVersionFilePath } from './paths.js'
import { validateFsVersionRecord } from './schema.js'
import type { FsVersionRecord } from './types.js'

/**
 * Atomically write `<projectRoot>/.memon/version.json`. Creates the
 * `.memon/` directory if needed. Validates the record before writing.
 *
 * Atomic = write to a temp file in the same directory, then rename. A
 * crash mid-write leaves either the previous content or no marker, never
 * a half-written file.
 */
export async function writeFsVersion(projectRoot: string, record: FsVersionRecord): Promise<void> {
  validateFsVersionRecord(record)
  const { markerAbs } = resolveVersionFilePath(projectRoot)
  const dir = dirname(markerAbs)
  await fs.mkdir(dir, { recursive: true })

  const serialised = `${JSON.stringify(record, null, 2)}\n`
  const tmpAbs = `${markerAbs}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
  await fs.writeFile(tmpAbs, serialised, 'utf8')
  try {
    await fs.rename(tmpAbs, markerAbs)
  } catch (err) {
    // Clean up the temp file if the rename failed; let the original error propagate.
    await fs.rm(tmpAbs, { force: true }).catch(() => {})
    throw err
  }
}
