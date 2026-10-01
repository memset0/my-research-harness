// discoverRuns — locate Run directories under the project's logs/, outputs/,
// and experiments/ entry directories only. Missing entries are skipped.
//
// Within those entries, Run directories may occur at any depth and are
// recognized by RUN_DIR_REGEX; traversal stops at each recognized Run.
//
// Run directories never nest: a Run-shaped name is a candidate Run whether
// or not it holds a README, and its contents are never listed, so the
// listing count of a walk does not depend on what Runs contain (pinned by
// discover.count.test.ts).
//
// v4: this layer now returns ALL matching paths regardless of archive
// state. Archive filtering happens post-parse in `scanProjectRoot` (and
// other higher-level callers) because the v4 source of truth is the
// README's `archived: bool` frontmatter, not the legacy sidecar. The
// sidecar fallback is centralized in `runArchivedFromFrontmatter` for the
// migration window only.

import type { Dirent } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { projectFs } from '../project-file-store.js'
import type { ProjectConfig, Run } from '../types.js'
import { DEFAULT_EXCLUDES, RUN_DIR_REGEX } from '../types.js'
import { isArchivedSidecar } from './archive.js'

// Re-export for back-compat with code that imported the constant from
// discover.ts (the canonical home is now archive.ts).
export { ARCHIVED_SIDECAR, isArchived, isArchivedSidecar } from './archive.js'

/**
 * Ceiling on concurrent directory listings during the Run walk. Matches
 * `scanProjectRoot`'s Run-read concurrency; inside a project file context the
 * shared store applies its own per-storage-group scheduling on top.
 */
const READDIR_CONCURRENCY = 16

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
 * Returns absolute Run paths under `project.root/{logs,outputs,experiments}`,
 * applying default + user excludes. The project root itself is never listed.
 *
 * This is the ONE sanctioned recursive project traversal, and it composes
 * shared cached direct listings (`projectFs.readdir`) rather than a recursive
 * filesystem API: inside a project file context every level is a coalesced,
 * scheduled, cached `listDir` observation. Sibling listings run concurrently
 * under `READDIR_CONCURRENCY` because a directory walk is dominated by
 * per-listing latency (painfully so on a network filesystem); the result is
 * sorted, so completion order never leaks into the output. A directory whose
 * base name matches the Run regex is recorded and never descended into, so Run
 * outputs are never enumerated. Directory symlinks are not followed
 * (`withFileTypes` reports the link, whose `isDirectory()` is false).
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
  const matchesInclude = compileMatcher(project.include.length > 0 ? project.include : ['**/*'])
  const excludes = mergeExcludes(project.exclude)
  // Plain names prune a directory (and its subtree) at any depth; patterns keep
  // the previous `**/<pattern>` + `**/<pattern>/**` ignore semantics.
  const excludedNames: Record<string, true> = {}
  const excludedPatterns: string[] = []
  for (const exclude of excludes) {
    if (exclude.includes('/') || exclude.includes('*') || exclude.includes('?')) {
      excludedPatterns.push(`**/${exclude}`, `**/${exclude}/**`)
    } else {
      excludedNames[exclude] = true
    }
  }
  const matchesExclude = compileMatcher(excludedPatterns)

  const found: string[] = []
  // Fixed ceiling of in-flight listings. Handing a slot straight to the next
  // waiter keeps `active` accurate without re-checking the limit.
  let active = 0
  const waiting: (() => void)[] = []
  const acquire = async (): Promise<void> => {
    if (active < READDIR_CONCURRENCY) {
      active += 1
      return
    }
    await new Promise<void>((resolve) => waiting.push(resolve))
  }
  const release = (): void => {
    const next = waiting.shift()
    if (next === undefined) active -= 1
    else next()
  }

  const walk = async (directory: string): Promise<void> => {
    let entries: Dirent[]
    await acquire()
    try {
      entries = await projectFs.readdir(directory, { withFileTypes: true })
    } catch {
      // Missing / unreadable directories are skipped, matching the previous
      // `suppressErrors` behaviour of the glob walk.
      return
    } finally {
      release()
    }
    const descend: string[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const name = entry.name
      // fast-glob ran with `dot: false`; dot directories stayed invisible.
      if (name.startsWith('.')) continue
      if (excludedNames[name] === true) continue
      const absolute = join(directory, name)
      const relativePath = relative(project.root, absolute).split(sep).join('/')
      if (matchesExclude(relativePath)) continue
      if (regex.test(name)) {
        if (matchesInclude(relativePath)) found.push(absolute)
        continue
      }
      descend.push(absolute)
    }
    await Promise.all(descend.map(walk))
  }

  await Promise.all(
    ['logs', 'outputs', 'experiments'].map(async (name) => {
      if (excludedNames[name] === true || matchesExclude(name)) return
      const directory = join(project.root, name)
      try {
        const entry = await projectFs.lstat(directory)
        if (!entry.isDirectory() || entry.isSymbolicLink()) return
      } catch (error) {
        if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return
        throw error
      }
      await walk(directory)
    }),
  )

  return found.sort()
}

/**
 * v4 archive-state resolver. Reads the run's archive flag from the parsed
 * README's frontmatter. Falls back to the legacy `<runDir>/.archived`
 * sidecar ONLY when the README never declared the `archived` key (v6 knows
 * this from `frontMatterKeys`, since an absent key is no longer a parse
 * warning). The fallback exists for the v3→v4 migration window and for
 * projects copied between machines mid-migration.
 *
 * Side-effect: when the sidecar fallback applies OR when the frontmatter
 * is present but a stale sidecar coexists, this function appends a
 * `LEGACY_ARCHIVE_SIDECAR` parse warning to `run.parseWarnings` (mutating
 * the array in place) so downstream consumers (lint, web UI, etc.) see
 * the migration nudge. Idempotent — won't re-add the warning if it's
 * already present.
 */
export async function runArchivedFromRun(run: Run): Promise<boolean> {
  const fieldMissing = !run.frontMatterKeys.includes('archived')
  const sidecarPresent = await isArchivedSidecar(run.path)

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

/**
 * Compile project-relative glob patterns (`**`, `*`, `?`, literal segments)
 * into one predicate. This replaces fast-glob for the Run walk: the walk owns
 * traversal through cached listings and only needs pattern membership. An
 * empty pattern list matches nothing.
 */
function compileMatcher(patterns: ReadonlyArray<string>): (relativePath: string) => boolean {
  if (patterns.length === 0) return () => false
  const compiled = patterns.map(globToRegExp)
  return (relativePath) => compiled.some((expression) => expression.test(relativePath))
}

function globToRegExp(pattern: string): RegExp {
  const segments = pattern.split('/')
  let source = '^'
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1
    if (segment === '**') {
      // Trailing `**` swallows the rest; an inner `**` spans zero or more
      // whole segments, so `**/*` matches both `a` and `a/b/c`.
      source += last ? '.*' : '(?:[^/]+/)*'
      return
    }
    for (const character of segment) {
      if (character === '*') source += '[^/]*'
      else if (character === '?') source += '[^/]'
      else source += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
    if (!last) source += '/'
  })
  return new RegExp(`${source}$`)
}
