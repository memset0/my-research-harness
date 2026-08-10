// Discovery for v5 experiment docs at `<projectRoot>/docs/experiments/`.
//
// Each subdirectory matching `E<NNNN>-<slug>` is scanned for a `README.md`
// file; that file is parsed and added to the index. Other files / subdirs
// inside the experiment folder (smoke scripts, sbatch templates, etc.) are
// the user's local scratch space and are NOT scanned. Folder names that
// don't match the regex are silently ignored.
//
// Legacy v4 fallback: a top-level `E<NNNN>-<slug>.md` file (no folder yet —
// mid-migration) is still parsed; the record surfaces a `LEGACY_LAYOUT`
// parse warning steering the user to `memon-migrate-fs`. After migration
// completes, the legacy branch never fires in normal operation.
//
// If both a `.md` file AND a `<slug>/` folder exist for the same id, that's
// a `MIGRATION_COLLISION` — the folder takes precedence (the user has
// already migrated; the dangling `.md` is leftover the user must clean up
// manually). A `MIGRATION_COLLISION` warning surfaces on the record so the
// user can see and resolve.

import { promises as fs } from 'node:fs'
import * as path from 'node:path'

import type { Experiment } from '../types.js'
import { EXPERIMENT_DIR_REGEX, EXPERIMENT_FILENAME_REGEX } from '../types.js'
import { readExperimentManagedDocuments } from './documents.js'
import { buildExperimentRecord, parseExperimentReadme } from './parse.js'

const EXPERIMENTS_SUBDIR = 'docs/experiments'

export interface DiscoverExperimentsResult {
  experiments: Experiment[]
}

/**
 * Scan `<projectRoot>/docs/experiments/` and return parsed experiment
 * records. The membership project is supplied by the caller from
 * `config.yml`'s project name.
 *
 * v5 layout: each experiment lives at `E<NNNN>-<slug>/README.md`. v4
 * legacy layout (`E<NNNN>-<slug>.md`) is still tolerated mid-migration and
 * surfaces a `LEGACY_LAYOUT` warning on the record.
 */
export async function discoverExperiments(
  projectRoot: string,
  projectName: string,
): Promise<DiscoverExperimentsResult> {
  const dir = path.join(projectRoot, EXPERIMENTS_SUBDIR)
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code === 'ENOENT') return { experiments: [] }
    throw err
  }

  // First pass: bucket entries by id (`E<NNNN>-<slug>`), distinguishing
  // v5 folders from legacy v4 files. Detect MIGRATION_COLLISION when both
  // forms exist for the same id.
  const folderIds = new Map<string, string>() // id -> entry name (folder)
  const legacyIds = new Map<string, string>() // id -> entry name (.md file)
  for (const entry of entries) {
    const folderMatch = entry.match(EXPERIMENT_DIR_REGEX)
    if (folderMatch) {
      folderIds.set(`E${folderMatch[1]}-${folderMatch[2]}`, entry)
      continue
    }
    const fileMatch = entry.match(EXPERIMENT_FILENAME_REGEX)
    if (fileMatch) {
      legacyIds.set(`E${fileMatch[1]}-${fileMatch[2]}`, entry)
    }
  }

  const experiments: Experiment[] = []

  // Resolve folder-form entries (v5 canonical) — these take precedence on
  // collision.
  for (const [id, folderName] of folderIds) {
    const folderPath = path.join(dir, folderName)
    let folderStat: Awaited<ReturnType<typeof fs.stat>>
    try {
      folderStat = await fs.stat(folderPath)
    } catch {
      continue
    }
    if (!folderStat.isDirectory()) continue
    const readmePath = path.join(folderPath, 'README.md')
    let readmeStat: Awaited<ReturnType<typeof fs.stat>>
    try {
      readmeStat = await fs.stat(readmePath)
    } catch {
      // Folder exists but no README inside — surface MISSING_README on a
      // placeholder record so the user sees the inconsistency in the
      // dashboard / `memon doctor`.
      const placeholder = parseExperimentReadme('', folderName)
      placeholder.parseErrors.push({
        message: `MISSING_README: experiment folder ${folderName}/ has no README.md inside`,
        severity: 'error',
      })
      experiments.push(
        buildExperimentRecord(placeholder, {
          id,
          project: projectName,
          path: readmePath,
          mtime: folderStat.mtimeMs,
          readmeMtime: 0,
        }),
      )
      continue
    }
    if (!readmeStat.isFile()) continue
    let content = ''
    try {
      content = await fs.readFile(readmePath, 'utf8')
    } catch {
      continue
    }
    const parsed = parseExperimentReadme(content, folderName)
    const { documents, mtime: documentMtime } = await readDocumentsWithMtime(folderPath)
    // Collision: a same-id `.md` file ALSO exists alongside this folder.
    if (legacyIds.has(id)) {
      parsed.parseWarnings.push({
        message: `MIGRATION_COLLISION: a v4 legacy file ${legacyIds.get(id)} exists alongside the v5 folder ${folderName}/; the folder is canonical — remove the dangling .md manually`,
        severity: 'warning',
      })
    }
    experiments.push(
      buildExperimentRecord(parsed, {
        id,
        project: projectName,
        path: readmePath,
        mtime: Math.max(readmeStat.mtimeMs, documentMtime),
        readmeMtime: readmeStat.mtimeMs,
        documents,
      }),
    )
  }

  // Resolve legacy-file entries that have NO matching folder. These are
  // pre-migration projects (or partial migrations) — surface
  // LEGACY_LAYOUT but still parse the content so the user can read in
  // degraded mode.
  for (const [id, fileName] of legacyIds) {
    if (folderIds.has(id)) continue // already handled above with MIGRATION_COLLISION
    const filePath = path.join(dir, fileName)
    let stat: Awaited<ReturnType<typeof fs.stat>>
    try {
      stat = await fs.stat(filePath)
    } catch {
      continue
    }
    if (!stat.isFile()) continue
    let content = ''
    try {
      content = await fs.readFile(filePath, 'utf8')
    } catch {
      continue
    }
    // For the legacy file, the filename stem (`E0001-foo`) plays the role
    // of the v5 folder name when passed to the parser.
    const stem = fileName.replace(/\.md$/, '')
    const parsed = parseExperimentReadme(content, stem)
    parsed.parseWarnings.push({
      message: `LEGACY_LAYOUT: experiment doc is at the v4 file path ${fileName}; run \`memon-migrate-fs\` to move it into ${stem}/README.md`,
      severity: 'warning',
    })
    experiments.push(
      buildExperimentRecord(parsed, {
        id,
        project: projectName,
        path: filePath,
        mtime: stat.mtimeMs,
        readmeMtime: stat.mtimeMs,
      }),
    )
  }

  return { experiments }
}

/**
 * Read a single experiment doc by id (`E<NNNN>-<slug>`) under the given
 * project root. Resolves the v5 folder layout first; falls back to the
 * legacy v4 file form (with `LEGACY_LAYOUT` warning) when only that
 * exists. Returns null when neither exists; throws on unrelated I/O.
 */
export async function readExperimentDoc(
  projectRoot: string,
  projectName: string,
  experimentId: string,
): Promise<Experiment | null> {
  if (!experimentId.match(EXPERIMENT_DIR_REGEX)) return null
  const folderPath = path.join(projectRoot, EXPERIMENTS_SUBDIR, experimentId)
  const readmePath = path.join(folderPath, 'README.md')
  const legacyPath = path.join(projectRoot, EXPERIMENTS_SUBDIR, `${experimentId}.md`)

  // Try v5 folder/README first.
  try {
    const stat = await fs.stat(readmePath)
    if (stat.isFile()) {
      const content = await fs.readFile(readmePath, 'utf8')
      const parsed = parseExperimentReadme(content, experimentId)
      const { documents, mtime: documentMtime } = await readDocumentsWithMtime(folderPath)
      // Check for collision: legacy file also present.
      try {
        const legacyStat = await fs.stat(legacyPath)
        if (legacyStat.isFile()) {
          parsed.parseWarnings.push({
            message: `MIGRATION_COLLISION: a v4 legacy file ${experimentId}.md exists alongside the v5 folder; remove it manually`,
            severity: 'warning',
          })
        }
      } catch {
        /* no legacy file — expected */
      }
      return buildExperimentRecord(parsed, {
        id: experimentId,
        project: projectName,
        path: readmePath,
        mtime: Math.max(stat.mtimeMs, documentMtime),
        readmeMtime: stat.mtimeMs,
        documents,
      })
    }
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code !== 'ENOENT') throw err
    // Folder/README doesn't exist yet — fall through to legacy probe.
  }

  // v5 not present; try v4 legacy file form.
  try {
    const stat = await fs.stat(legacyPath)
    if (!stat.isFile()) return null
    const content = await fs.readFile(legacyPath, 'utf8')
    const parsed = parseExperimentReadme(content, experimentId)
    parsed.parseWarnings.push({
      message: `LEGACY_LAYOUT: experiment doc is at the v4 file path; run \`memon-migrate-fs\` to move it into ${experimentId}/README.md`,
      severity: 'warning',
    })
    return buildExperimentRecord(parsed, {
      id: experimentId,
      project: projectName,
      path: legacyPath,
      mtime: stat.mtimeMs,
      readmeMtime: stat.mtimeMs,
    })
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code === 'ENOENT') return null
    throw err
  }
}

async function readDocumentsWithMtime(experimentDirectory: string) {
  const documents = await readExperimentManagedDocuments(experimentDirectory)
  let mtime = 0
  for (const parsed of [documents.implementation, documents.investigation, documents.results]) {
    if (!parsed.exists) continue
    try {
      const stat = await fs.stat(parsed.path)
      mtime = Math.max(mtime, stat.mtimeMs)
    } catch {
      // The parser already records a missing-file diagnostic. A concurrent
      // unlink between read and stat should not make discovery fail.
    }
  }
  return { documents, mtime }
}
