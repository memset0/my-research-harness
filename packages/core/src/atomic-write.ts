// The one whole-file replacement writer.
//
// The new content goes to a hidden sibling temp file which is then renamed
// over the target, so a reader never observes partial content. No fsync by
// default: memon runs on NFS/sshfs where fsync is expensive, and none of the
// previous per-module copies synced either. `fsync: true` opts in. The temp
// file is removed when the write or rename fails.

import type { promises as nodeFs } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { projectFs } from './project-file-store.js'

/** The fs/promises subset `writeFileAtomic` needs. */
export type AtomicWriteFs = Pick<typeof nodeFs, 'writeFile' | 'rename' | 'rm' | 'mkdir' | 'open'>

export interface WriteFileAtomicOptions {
  /** File mode for the new file (e.g. `0o600`). */
  mode?: number
  /** fsync the temp file before the rename. Off by default. */
  fsync?: boolean
  /** Create the parent directory first (`mkdir -p`). */
  mkdir?: boolean
  /**
   * Filesystem to write through. Defaults to `projectFs` (native outside a
   * project-file context); callers that previously bypassed the store pass
   * `node:fs` promises explicitly.
   */
  fs?: AtomicWriteFs
}

/** Hidden sibling temp path for `path`. */
export function atomicTempPath(path: string): string {
  const random = Math.random().toString(36).slice(2, 10)
  return join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.${random}.tmp`)
}

export async function writeFileAtomic(
  path: string,
  data: string | Uint8Array,
  opts: WriteFileAtomicOptions = {},
): Promise<void> {
  const fs = opts.fs ?? (projectFs as unknown as AtomicWriteFs)
  if (opts.mkdir === true) await fs.mkdir(dirname(path), { recursive: true })
  const tmp = atomicTempPath(path)
  try {
    if (opts.fsync === true) {
      const handle = await fs.open(tmp, 'w', opts.mode)
      try {
        await handle.writeFile(data, typeof data === 'string' ? 'utf8' : undefined)
        await handle.sync()
      } finally {
        await handle.close()
      }
    } else {
      await fs.writeFile(tmp, data, {
        encoding: typeof data === 'string' ? 'utf8' : null,
        ...(opts.mode === undefined ? {} : { mode: opts.mode }),
      })
    }
    await fs.rename(tmp, path)
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw error
  }
}
