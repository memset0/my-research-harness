// Bootstrap of `.memon/index/`.
//
// `.memon/` itself holds tracked files (`version.json`, `wiki-review.csv`), so
// the index carries its own self-ignoring `.gitignore` (`*` ignores the
// directory and everything in it). Whoever creates the directory writes it
// first, before any snapshot, lock or event file.

import { defaultIndexFs, errnoCode, type IndexFs } from './fs.js'
import { INDEX_GITIGNORE_CONTENT, type IndexPaths } from './paths.js'

/**
 * Make sure `.memon/index/.gitignore` exists (and, with `events`, the
 * `events/` directory). Idempotent; concurrent callers race safely because
 * the ignore file is created exclusively.
 */
export async function ensureIndexDirectory(
  paths: IndexPaths,
  options: { fs?: IndexFs; events?: boolean } = {},
): Promise<void> {
  const fs = options.fs ?? defaultIndexFs
  let present = false
  try {
    await fs.stat(paths.gitignore)
    present = true
  } catch (error) {
    if (errnoCode(error) !== 'ENOENT') throw error
  }
  if (!present) {
    await fs.mkdir(paths.dir, { recursive: true })
    try {
      await fs.writeFile(paths.gitignore, INDEX_GITIGNORE_CONTENT, { encoding: 'utf8', flag: 'wx' })
    } catch (error) {
      if (errnoCode(error) !== 'EEXIST') throw error
    }
  }
  if (options.events) await fs.mkdir(paths.events, { recursive: true })
}
