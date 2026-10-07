// Legacy `.archived` sidecar reads. Archiving a Run toggles the README's
// `archived` frontmatter field through the shared `setRunArchiveState`
// mutation primitive (`runs/mutations.ts`), per `archive-frontmatter`. The
// sidecar is no longer the source of truth — the v3→v4 migration cleans it
// up; v4 readers honor it only as a narrow fallback when the README lacks the
// canonical `archived` field entirely.

import { join } from '@memon/file-protocol/paths'
import { projectFs as fs } from '../project-file-store.js'

/** Sidecar filename retained for the migration-window fallback. */
export const ARCHIVED_SIDECAR = '.archived'

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
