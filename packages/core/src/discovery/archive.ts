// v4: Archive a run by toggling the `archived` field in the README's
// frontmatter (atomic write), per `archive-frontmatter` spec. The legacy
// `<runDir>/.archived` sidecar is no longer the source of truth — when an
// existing sidecar is present, the v3→v4 migration cleans it up; v4 readers
// honor the sidecar only as a narrow fallback when the README lacks the
// canonical `archived` field entirely.

import { join } from 'node:path'
import { writeFileAtomic } from '../atomic-write.js'
import { projectFs as fs } from '../project-file-store.js'
import { parseReadme } from '../readme/parse.js'
import { reserializeReadme } from '../readme/serialize.js'

/** Sidecar filename retained for the migration-window fallback. */
export const ARCHIVED_SIDECAR = '.archived'

export interface ArchiveResult {
  archived: boolean
  /** True when the toggle did nothing (already in the requested state). */
  noop: boolean
  /** Pre-write archive state — useful for the soft-warning check. */
  prevArchived: boolean
  /** Pre-write status — useful for hard-rule enforcement at the call site. */
  prevStatus: string
}

export class ArchiveRunningForbiddenError extends Error {
  code = 'ARCHIVE_RUNNING_FORBIDDEN'
  constructor(public id: string) {
    super(`cannot archive a RUNNING run; set status to INTERRUPTED, FINISHED, or FAILED first`)
    this.name = 'ArchiveRunningForbiddenError'
  }
}

interface SetArchivedOptions {
  /** ISO8601 with offset; bumped into `updated_at` on a real write. */
  now: string
  /** Run id used in error / log messages (defaults to runDir basename). */
  id?: string
}

/**
 * Set the run's archive state to the given target by rewriting the README's
 * frontmatter. If `target === true` and current `status === 'RUNNING'`, throws
 * `ArchiveRunningForbiddenError`. If the target equals the current value, the
 * function is a no-op (no write, no mtime bump). Returns the old/new state.
 */
export async function setRunArchived(
  runDir: string,
  target: boolean,
  options: SetArchivedOptions,
): Promise<ArchiveResult> {
  const readmePath = join(runDir, 'README.md')
  const content = await fs.readFile(readmePath, 'utf8')
  const parsed = parseReadme(content)
  const prevArchived = parsed.frontMatter.archived
  const prevStatus = parsed.frontMatter.status

  if (prevArchived === target) {
    return { archived: target, noop: true, prevArchived, prevStatus }
  }
  if (target === true && prevStatus === 'RUNNING') {
    throw new ArchiveRunningForbiddenError(options.id ?? parsed.frontMatter.id)
  }
  parsed.frontMatter.archived = target
  parsed.frontMatter.updatedAt = options.now
  await writeFileAtomic(readmePath, reserializeReadme(parsed))
  return { archived: target, noop: false, prevArchived, prevStatus }
}

/** Mark a run as archived. */
export async function archiveRun(
  runDir: string,
  options: SetArchivedOptions,
): Promise<ArchiveResult> {
  return setRunArchived(runDir, true, options)
}

/** Remove the archive marker. */
export async function unarchiveRun(
  runDir: string,
  options: SetArchivedOptions,
): Promise<ArchiveResult> {
  return setRunArchived(runDir, false, options)
}

/**
 * Legacy sidecar fallback: returns true iff `<runDir>/.archived` exists.
 * v4 readers SHALL only consult this when the README's frontmatter never
 * declared the canonical `archived` field (see `frontMatterKeys`).
 * Production discovery should call `runArchivedFromRun`
 * below, not this directly.
 */
export async function isArchivedSidecar(runDir: string): Promise<boolean> {
  try {
    await fs.access(join(runDir, ARCHIVED_SIDECAR))
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return false
    throw error
  }
}

/**
 * Back-compat alias for `isArchivedSidecar`. Kept so existing callers that
 * imported `isArchived` from this module compile until they migrate; new
 * code should use `runArchivedFromFrontmatter` (in discover.ts).
 */
export const isArchived = isArchivedSidecar
