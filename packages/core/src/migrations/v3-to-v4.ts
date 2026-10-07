// v3 → v4 deterministic transform.
//
// v3→v4 introduces two new required frontmatter fields:
//   - run README:       `archived: boolean`           (default false; true if a `<runDir>/.archived` sidecar exists)
//   - experiment doc:   `status: ExperimentStatus`     (default `OPEN`)
//                       `archived: boolean`            (default `false`)
//
// The transforms are idempotent: re-running on already-migrated content
// is a no-op (no `updated_at` bump, no rewrite).
//
// See packages/core/migrations/v3-to-v4.md for the full agent-facing
// recipe (with Verification + Edge Cases sections per
// fs-migration-guide-authoring/spec.md).

import { existsSync, promises as fs } from 'node:fs'
import { join } from '@memon/file-protocol/paths'
import { writeFileAtomic } from '../atomic-write.js'
import { ARCHIVED_SIDECAR } from './../discovery/archive.js'
import { type ParsedExperiment, parseExperimentReadme } from '../experiments/parse.js'
import { serializeExperimentReadme } from '../experiments/serialize.js'
import { parseReadme } from '../readme/parse.js'
import { reserializeReadme, serializeReadme } from '../readme/serialize.js'

export interface RewriteV3RunInput {
  /** Raw v3 README content (entire file, frontmatter + body). */
  v3Content: string
  /** Whether the legacy `<runDir>/.archived` sidecar existed pre-migration. */
  hadSidecar: boolean
  /** ISO8601 with offset; written into `updated_at` ONLY when changed. */
  migrationTime: string
}

export interface RewriteV3RunResult {
  /** Re-serialized v4 content. */
  content: string
  /** True when content matches v3Content byte-for-byte (no rewrite needed). */
  unchanged: boolean
}

/**
 * Transform a v3 run into its historical v4 target, which requires an
 * explicit archive flag. New v6 records may omit false defaults, but that
 * does not change the schema of this migration's intermediate output.
 */
export function rewriteV3RunReadme(input: RewriteV3RunInput): RewriteV3RunResult {
  const parsed = parseReadme(input.v3Content)
  // v6: an absent `archived` key is reported through `frontMatterKeys`
  // rather than a parse warning.
  const fieldMissing = !parsed.frontMatterKeys.includes('archived')
  if (!fieldMissing) {
    // Preserve an explicit flag, including false in the presence of a sidecar.
    return { content: input.v3Content, unchanged: true }
  }
  parsed.frontMatter.archived = input.hadSidecar
  parsed.frontMatterKeys.push('archived')
  parsed.frontMatter.updatedAt = input.migrationTime
  return { content: reserializeReadme(parsed), unchanged: false }
}

export interface RewriteV3ExpInput {
  /** Raw v3 exp doc content (entire file). */
  v3Content: string
  /** Filename stem (e.g. `E0001-zero-snr-fix`) for parser cross-check. */
  filenameStem: string
  /** ISO8601 with offset; written into `updated_at` ONLY when changed. */
  migrationTime: string
}

export interface RewriteV3ExpResult {
  content: string
  unchanged: boolean
  parsed: ParsedExperiment
}

/**
 * Transform a single v3 exp doc into v4 shape. Inserts `status: OPEN` and
 * `archived: false` if missing. Returns `unchanged: true` when neither was
 * missing (no rewrite, no updated_at bump).
 */
export function rewriteV3ExpDoc(input: RewriteV3ExpInput): RewriteV3ExpResult {
  const parsed = parseExperimentReadme(input.v3Content, input.filenameStem)
  const missingStatus = parsed.parseWarnings.some((w) => w.message.startsWith('MISSING_EXP_STATUS'))
  const missingArchived = parsed.parseWarnings.some((w) =>
    w.message.startsWith('MISSING_ARCHIVED_FIELD'),
  )
  if (!missingStatus && !missingArchived) {
    return { content: input.v3Content, unchanged: true, parsed }
  }
  // Defaults are already applied by the parser when missing — just bump
  // updated_at and re-serialize.
  parsed.frontMatter.updatedAt = input.migrationTime
  const content = serializeExperimentReadme({
    frontMatter: parsed.frontMatter,
    sections: parsed.sections,
    warningsRaw: parsed.warningsRaw,
    rawSections: parsed.rawSections,
    rawBody: parsed.body,
  })
  return { content, unchanged: false, parsed }
}

export interface MigrateV3ToV4Options {
  /** Project root (absolute). */
  projectRoot: string
  /** ISO8601 with offset; bumped into `updated_at` for files that change. */
  migrationTime: string
  /**
   * Optional: list of run dir absolute paths. When omitted, the runtime is
   * expected to discover runs separately and call `rewriteV3RunReadme` on
   * each. This module exposes file-IO helpers for the common case where the
   * caller wants the whole walk done end-to-end.
   */
  runDirs?: string[]
  /**
   * Optional: list of exp doc absolute paths. Same pattern as runDirs.
   */
  expDocPaths?: string[]
}

export interface MigrateV3ToV4Stat {
  /** Absolute path. */
  path: string
  /** True iff content was rewritten (and updated_at bumped). */
  changed: boolean
  /** Run side only: true iff a `<runDir>/.archived` sidecar was unlinked. */
  sidecarDeleted?: boolean
}

export interface MigrateV3ToV4Result {
  runStats: MigrateV3ToV4Stat[]
  expStats: MigrateV3ToV4Stat[]
}

/**
 * End-to-end v3→v4 walk: rewrites every supplied run README and exp doc,
 * deleting the legacy sidecar on each run AFTER the README write succeeds.
 * Idempotent — passes that find nothing to change return `changed: false`
 * for every entry and don't touch any file.
 *
 * Caller is responsible for stamping `.memon/version.json` to v4 (and
 * deciding whether to do that based on the absence of any failure here).
 */
export async function migrateV3ToV4(options: MigrateV3ToV4Options): Promise<MigrateV3ToV4Result> {
  const runStats: MigrateV3ToV4Stat[] = []
  const expStats: MigrateV3ToV4Stat[] = []

  for (const runDir of options.runDirs ?? []) {
    const readmePath = join(runDir, 'README.md')
    let content: string
    try {
      content = await fs.readFile(readmePath, 'utf8')
    } catch {
      // No README in this run dir — nothing to migrate. Skip.
      continue
    }
    const sidecarPath = join(runDir, ARCHIVED_SIDECAR)
    const hadSidecar = existsSync(sidecarPath)
    const rewrite = rewriteV3RunReadme({
      v3Content: content,
      hadSidecar,
      migrationTime: options.migrationTime,
    })
    if (!rewrite.unchanged) {
      await writeFileAtomic(readmePath, rewrite.content, { fs })
    }
    let sidecarDeleted = false
    // Always clean up sidecar after a successful README state — whether
    // we rewrote (just inserted archived from sidecar) or already had
    // the field (in which case the sidecar was a stale leftover).
    if (hadSidecar) {
      try {
        await fs.unlink(sidecarPath)
        sidecarDeleted = true
      } catch {
        // Best-effort; the discovery layer's runArchivedFromRun
        // tolerates this (frontmatter wins).
      }
    }
    runStats.push({ path: readmePath, changed: !rewrite.unchanged, sidecarDeleted })
  }

  for (const expPath of options.expDocPaths ?? []) {
    let content: string
    try {
      content = await fs.readFile(expPath, 'utf8')
    } catch {
      continue
    }
    // Filename stem = basename without .md extension.
    const stem = expPath.split(/[\\/]/).pop()!.replace(/\.md$/, '')
    const rewrite = rewriteV3ExpDoc({
      v3Content: content,
      filenameStem: stem,
      migrationTime: options.migrationTime,
    })
    if (!rewrite.unchanged) {
      await writeFileAtomic(expPath, rewrite.content, { fs })
    }
    expStats.push({ path: expPath, changed: !rewrite.unchanged })
  }

  return { runStats, expStats }
}

// Silence unused import in some build modes (TS strict).
void serializeReadme
