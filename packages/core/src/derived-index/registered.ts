import { join, relative, sep } from '@memon/file-protocol/paths'
import { projectFs as fs } from '../project-file-store.js'
import { type IndexSnapshot, parseSnapshot } from './schema.js'

/** Source-side CLI lookup for FS11: one inventory, no fallback directory walk. */
export async function registeredSnapshot(root: string): Promise<IndexSnapshot | null> {
  let version: { fs_convention_version?: number }
  try {
    version = JSON.parse(await fs.readFile(join(root, '.memon/version.json'), 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  if ((version.fs_convention_version ?? 0) < 11) return null
  try {
    const path = join(root, '.memon/index/snapshot.json')
    const rel = relative(await fs.realpath(root), await fs.realpath(path))
    if (rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('Index escapes project root')
    const parsed = parseSnapshot(JSON.parse(await fs.readFile(path, 'utf8')))
    if (!parsed.ok) throw new Error(parsed.reason)
    return parsed.value
  } catch (error) {
    throw new Error(
      `REGISTERED_INDEX_UNAVAILABLE: run memon index rebuild; ${(error as Error).message}`,
    )
  }
}
