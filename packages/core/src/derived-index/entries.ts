// Entry derivation: the index entry of one Run, Experiment or wiki page from
// the project files alone (README content plus stats). Writers pass the
// post-write content they already hold so an event costs stats only; rebuild
// and verification read the files themselves.

import { basename, dirname, join, relative, sep } from 'node:path'
import { runEligibilityError } from '../discovery/eligibility.js'
import { readRunDir, runFromReadme } from '../discovery/read.js'
import { type ParsedExperiment, parseExperimentReadme } from '../experiments/parse.js'
import { formatIsoLocal } from '../time.js'
import type { Run } from '../types.js'
import { EXPERIMENT_DIR_REGEX, EXPERIMENT_FILENAME_REGEX } from '../types.js'
import { parseWikiFrontmatter } from '../wiki/frontmatter.js'
import { buildWikiSummary } from '../wiki/summary.js'
import type { WikiPageFormat } from '../wiki/types.js'
import { type PersistedFingerprint, persistedFingerprint } from './fingerprint.js'
import { defaultIndexFs, errnoCode, type IndexFs } from './fs.js'
import type { ExperimentIndexEntry, RunIndexEntry, RunRow, WikiIndexEntry } from './schema.js'

/** Project-relative POSIX form of an absolute path inside `root`. */
export function indexKey(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join('/')
}

async function statOrNull(fs: IndexFs, path: string) {
  try {
    return await fs.stat(path)
  } catch (error) {
    const code = errnoCode(error)
    if (code === 'ENOENT' || code === 'ENOTDIR') return null
    throw error
  }
}

function warningCode(message: string): string {
  const match = /^([A-Z][A-Z0-9_]+):/.exec(message)
  return match ? match[1]! : 'PARSE_WARNING'
}

/** The persisted list row of a parsed Run (fields not already on the entry). */
export function runRowFromRun(run: Run): RunRow {
  const fm = run.frontMatter
  return {
    mtime: run.mtime,
    readme_mtime: run.readmeMtime,
    id: fm.id,
    name: fm.name,
    project: fm.project,
    finished_at: fm.finishedAt,
    host: fm.host,
    pid: fm.pid,
    gpus: [...fm.gpus],
    entry: fm.entry,
    command: fm.command,
    wandb: fm.wandb,
    hypotheses: [...fm.hypotheses],
    tags: [...fm.tags],
    parse_errors: run.parseErrors.map((issue) => ({ ...issue })),
    parse_warnings: run.parseWarnings.map((issue) => ({ ...issue })),
  }
}

export interface DeriveRunEntryInput {
  projectRoot: string
  /** Absolute Run directory. */
  runDir: string
  /** README content already held by the caller; omitted → read; null → absent. */
  content?: string | null
  /** The directory was verified inside the project with real paths. */
  contained?: boolean
  fs?: IndexFs
  now?: () => Date
}

/** The Run entry for `runDir`, or null when the directory does not exist. */
export async function deriveRunEntry(input: DeriveRunEntryInput): Promise<RunIndexEntry | null> {
  const fs = input.fs ?? defaultIndexFs
  const readmePath = join(input.runDir, 'README.md')
  const [dirStat, readmeStat] = await Promise.all([
    statOrNull(fs, input.runDir),
    input.content === null ? Promise.resolve(null) : statOrNull(fs, readmePath),
  ])
  if (!dirStat?.isDirectory()) return null
  let run: Run
  let eligibilityError: string | null = null
  const hasReadme = readmeStat?.isFile() === true
  if (hasReadme) {
    const content = input.content ?? (await fs.readFile(readmePath, 'utf8'))
    run = runFromReadme(input.runDir, '', content, dirStat.mtimeMs, readmeStat.mtimeMs)
    eligibilityError = runEligibilityError(content)
  } else {
    run = await readRunDir(input.runDir, '')
  }
  let archiveSource: RunIndexEntry['archive_source'] = 'frontmatter'
  let archived = run.frontMatter.archived
  if (!run.frontMatterKeys.includes('archived')) {
    const sidecar = await statOrNull(fs, join(input.runDir, '.archived'))
    archiveSource = sidecar ? 'sidecar' : 'none'
    archived = sidecar !== null
  }
  const fm = run.frontMatter
  return {
    readme_fp: hasReadme ? persistedFingerprint(readmeStat) : null,
    dir_fp: persistedFingerprint(dirStat),
    verified_at: formatIsoLocal((input.now ?? (() => new Date()))()),
    has_readme: hasReadme,
    status: fm.status,
    ...(fm.createdAt ? { created_at: fm.createdAt } : {}),
    ...(fm.updatedAt ? { updated_at: fm.updatedAt } : {}),
    archived,
    archive_source: archiveSource,
    deprecated: fm.deprecated,
    eligibility_error: eligibilityError,
    contained: input.contained ?? false,
    owner: null,
    row: runRowFromRun(run),
    parse_error_count: run.parseErrors.length,
    parse_warning_codes: [...new Set(run.parseWarnings.map((issue) => warningCode(issue.message)))],
  }
}

/** Where an Experiment document lives: folder README or legacy single file. */
export interface ExperimentLocation {
  /** Index key: `docs/experiments/E<NNNN>-<slug>` or the legacy `….md` path. */
  key: string
  id: string
  stem: string
  readmePath: string
  /** Absolute bundle folder; null for the legacy single file. */
  folder: string | null
}

/** Locate the Experiment owning `readmePath` (folder README or legacy file). */
export function experimentLocation(
  projectRoot: string,
  readmePath: string,
): ExperimentLocation | null {
  const name = basename(readmePath)
  if (name === 'README.md') {
    const folder = dirname(readmePath)
    const match = EXPERIMENT_DIR_REGEX.exec(basename(folder))
    if (!match) return null
    return {
      key: indexKey(projectRoot, folder),
      id: `E${match[1]}-${match[2]}`,
      stem: basename(folder),
      readmePath,
      folder,
    }
  }
  const legacy = EXPERIMENT_FILENAME_REGEX.exec(name)
  if (!legacy) return null
  return {
    key: indexKey(projectRoot, readmePath),
    id: `E${legacy[1]}-${legacy[2]}`,
    stem: name.replace(/\.md$/, ''),
    readmePath,
    folder: null,
  }
}

export interface DeriveExperimentEntryInput {
  projectRoot: string
  /** Absolute README (or legacy `.md`) path. */
  readmePath: string
  /** README content already held by the caller; omitted → read. */
  content?: string
  fs?: IndexFs
  now?: () => Date
}

/**
 * The Experiment entry for `readmePath` keyed by its folder (or legacy file),
 * or null when neither the document nor its folder exists. A folder without
 * a README yields the placeholder record discovery shows (`MISSING_README`).
 */
export async function deriveExperimentEntry(
  input: DeriveExperimentEntryInput,
): Promise<{ key: string; entry: ExperimentIndexEntry } | null> {
  const fs = input.fs ?? defaultIndexFs
  const location = experimentLocation(input.projectRoot, input.readmePath)
  if (!location) return null
  const yaml = (name: string) =>
    location.folder ? statOrNull(fs, join(location.folder, name)) : Promise.resolve(null)
  const [readmeStat, implementation, investigation, results] = await Promise.all([
    statOrNull(fs, input.readmePath),
    yaml('implementation.yaml'),
    yaml('investigation.yaml'),
    yaml('results.yaml'),
  ])
  let parsed: ParsedExperiment
  if (readmeStat?.isFile()) {
    const content = input.content ?? (await fs.readFile(input.readmePath, 'utf8'))
    parsed = parseExperimentReadme(content, location.stem)
  } else {
    if (!location.folder || !(await statOrNull(fs, location.folder))?.isDirectory()) return null
    parsed = parseExperimentReadme('', location.stem)
    parsed.parseErrors.push({
      message: `MISSING_README: experiment folder ${location.stem}/ has no README.md inside`,
      severity: 'error',
    })
  }
  const fingerprint = (
    stat: Awaited<ReturnType<typeof statOrNull>>,
  ): PersistedFingerprint | null => (stat?.isFile() ? persistedFingerprint(stat) : null)
  const fm = parsed.frontMatter
  return {
    key: location.key,
    entry: {
      dir: location.key,
      id: location.id,
      slug: fm.slug,
      status: fm.status,
      archived: fm.archived,
      runs: [...fm.runs],
      readme_fp: fingerprint(readmeStat),
      bundle_fp: {
        implementation: fingerprint(implementation),
        investigation: fingerprint(investigation),
        results: fingerprint(results),
      },
      verified_at: formatIsoLocal((input.now ?? (() => new Date()))()),
      row: {
        readme_mtime: readmeStat?.isFile() ? readmeStat.mtimeMs : 0,
        title: fm.title,
        tags: [...fm.tags],
        created_at: fm.createdAt,
        updated_at: fm.updatedAt,
        hypothesis_count: fm.hypotheses.length,
        open_warning_count: parsed.warnings.filter((warning) => warning.status === 'OPEN').length,
        parse_errors: parsed.parseErrors.map((issue) => ({ ...issue })),
        parse_warnings: parsed.parseWarnings.map((issue) => ({ ...issue })),
      },
    },
  }
}

export interface DeriveWikiEntryInput {
  /** Page identity as wiki discovery reports it. */
  page: {
    id: string
    slug: string
    kind: string
    format: WikiPageFormat
    /** Project-relative POSIX path of the `.md` / `README.md`. */
    path: string
    absolutePath: string
    content: string
  }
  fs?: IndexFs
  now?: () => Date
}

/** The wiki entry of one discovered page; null when the page file vanished. */
export async function deriveWikiEntry(
  input: DeriveWikiEntryInput,
): Promise<{ key: string; entry: WikiIndexEntry } | null> {
  const fs = input.fs ?? defaultIndexFs
  const stat = await statOrNull(fs, input.page.absolutePath)
  if (!stat?.isFile()) return null
  const { frontmatter, body } = parseWikiFrontmatter(input.page.content)
  const summary = buildWikiSummary({
    location: { ...input.page, mtime: stat.mtimeMs },
    frontmatter,
    body,
  })
  return {
    key: input.page.path,
    entry: {
      id: summary.id,
      kind: summary.kind,
      status: summary.status,
      title: summary.title,
      legacy_id: summary.legacyId,
      deprecated: summary.deprecated ? { ...summary.deprecated } : null,
      sources: [...summary.sources],
      fp: persistedFingerprint(stat),
      verified_at: formatIsoLocal((input.now ?? (() => new Date()))()),
    },
  }
}
