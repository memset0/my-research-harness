// Archive a run by toucing a sidecar file. README.md is never modified, so
// its mtime stays stable and the rest of the toolchain (caches, etag, etc.)
// keeps working.

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { ARCHIVED_SIDECAR, isArchived } from './discover.js'

export interface ArchiveResult {
  archived: boolean
  /** True when the toggle did nothing (already in the requested state). */
  noop: boolean
}

/** Mark a run as archived. No-op if already archived. */
export async function archiveRun(runDir: string): Promise<ArchiveResult> {
  const sidecar = join(runDir, ARCHIVED_SIDECAR)
  if (isArchived(runDir)) {
    return { archived: true, noop: true }
  }
  await fs.writeFile(sidecar, '', 'utf8')
  return { archived: true, noop: false }
}

/** Remove the archive marker. No-op if not archived. */
export async function unarchiveRun(runDir: string): Promise<ArchiveResult> {
  const sidecar = join(runDir, ARCHIVED_SIDECAR)
  if (!isArchived(runDir)) {
    return { archived: false, noop: true }
  }
  await fs.unlink(sidecar)
  return { archived: false, noop: false }
}
