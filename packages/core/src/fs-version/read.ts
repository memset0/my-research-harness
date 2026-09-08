import { projectFs as fs } from '../project-file-store.js'
import { resolveVersionFilePath } from './paths.js'
import { validateFsVersionRecord } from './schema.js'
import type { FsVersionRecord } from './types.js'

/**
 * Read `<projectRoot>/.memon/version.json` and return the parsed record.
 *
 * - Returns `null` if the file does not exist (uninitialised project root).
 * - Throws on JSON parse error or schema violation.
 */
export async function readFsVersion(projectRoot: string): Promise<FsVersionRecord | null> {
  const { markerAbs } = resolveVersionFilePath(projectRoot)
  let raw: string
  try {
    raw = await fs.readFile(markerAbs, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`failed to parse ${markerAbs} as JSON: ${(err as Error).message}`)
  }
  return validateFsVersionRecord(parsed)
}
