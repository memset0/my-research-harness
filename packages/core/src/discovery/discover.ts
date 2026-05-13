// discoverRuns — locate experiment directories under a project root.
//
// The directory base name must match RUN_DIR_REGEX. Parent directory
// name is irrelevant — we don't depend on `logs/` or `runs/` segments since
// the user's actual filesystem layout varies.
//
// v4: this layer now returns ALL matching paths regardless of archive
// state. Archive filtering happens post-parse in `scanProjectRoot` (and
// other higher-level callers) because the v4 source of truth is the
// README's `archived: bool` frontmatter, not the legacy sidecar. The
// sidecar fallback is centralized in `runArchivedFromFrontmatter` for the
// migration window only.

import fg from 'fast-glob'
import { basename } from 'node:path'
import type { ProjectConfig, Run } from '../types.js'
import { DEFAULT_EXCLUDES, RUN_DIR_REGEX } from '../types.js'
import { isArchivedSidecar } from './archive.js'

// Re-export for back-compat with code that imported the constant from
// discover.ts (the canonical home is now archive.ts).
export { ARCHIVED_SIDECAR, isArchivedSidecar, isArchived } from './archive.js'

export interface DiscoverOptions {
  /**
   * Optional override for the experiment directory regex (testing only).
   * Production code should always use the spec-mandated default.
   */
  regex?: RegExp
  /**
   * v4: included for API parity with prior versions, but the path-level
   * filter is gone — `discoverRuns` always returns all matching paths.
   * Archive-based filtering happens post-parse via `runArchivedFromRun`.
   * Callers that previously passed `includeArchived: false` should now
   * filter the parsed records themselves.
   */
  includeArchived?: boolean
}

/**
 * Returns absolute paths to all directories under `project.root` whose base
 * name matches the experiment regex, applying default + user excludes.
 *
 * v4 note: this function does NOT filter by archive state. The caller is
 * responsible for parsing each README and applying the archive filter via
 * `runArchivedFromRun` (which checks the frontmatter field with sidecar
 * fallback). See `scanProjectRoot` for the canonical pattern.
 */
export async function discoverRuns(
  project: ProjectConfig,
  options: DiscoverOptions = {},
): Promise<string[]> {
  const regex = options.regex ?? RUN_DIR_REGEX
  const include = project.include.length > 0 ? project.include : ['**/*']
  const excludes = mergeExcludes(project.exclude)
  const ignore = excludes.flatMap((e) => [`**/${e}`, `**/${e}/**`])

  const dirs = await fg(include, {
    cwd: project.root,
    onlyDirectories: true,
    ignore,
    absolute: true,
    dot: false,
    suppressErrors: true,
  })

  return dirs.filter((d) => regex.test(basename(d)))
}

/**
 * v4 archive-state resolver. Reads the run's archive flag from the parsed
 * README's frontmatter. Falls back to the legacy `<runDir>/.archived`
 * sidecar ONLY when the README lacks the canonical `archived` field
 * (detected by the `MISSING_ARCHIVED_FIELD` parse warning). The fallback
 * exists for the v3→v4 migration window and for projects copied between
 * machines mid-migration.
 *
 * Side-effect: when the sidecar fallback applies OR when the frontmatter
 * is present but a stale sidecar coexists, this function appends a
 * `LEGACY_ARCHIVE_SIDECAR` parse warning to `run.parseWarnings` (mutating
 * the array in place) so downstream consumers (doctor, web UI, etc.) see
 * the migration nudge. Idempotent — won't re-add the warning if it's
 * already present.
 */
export function runArchivedFromRun(run: Run): boolean {
  const fieldMissing = run.parseWarnings.some((w) =>
    w.message.startsWith('MISSING_ARCHIVED_FIELD'),
  )
  const sidecarPresent = isArchivedSidecar(run.path)

  // Surface the migration nudge whenever a sidecar coexists with a v4
  // README, OR when the README is missing the field and we're falling back.
  if (sidecarPresent || (fieldMissing && sidecarPresent)) {
    const alreadyFlagged = run.parseWarnings.some((w) =>
      w.message.startsWith('LEGACY_ARCHIVE_SIDECAR'),
    )
    if (!alreadyFlagged) {
      run.parseWarnings.push({
        field: 'archived',
        message: `LEGACY_ARCHIVE_SIDECAR: ${run.path}/.archived sidecar present; frontmatter is the canonical source in v4 — re-run migration to clean up`,
        severity: 'warning',
      })
    }
  }

  if (!fieldMissing) {
    return run.frontMatter.archived
  }
  return sidecarPresent
}

/**
 * Merge project-level user excludes with the spec-mandated defaults.
 * Order: defaults first, then user (deduped).
 */
export function mergeExcludes(userExcludes: ReadonlyArray<string>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const e of [...DEFAULT_EXCLUDES, ...userExcludes]) {
    if (!seen.has(e)) {
      seen.add(e)
      out.push(e)
    }
  }
  return out
}
