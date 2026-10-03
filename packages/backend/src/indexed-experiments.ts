// Experiment list rows and identities served from the Project summary index.
//
// A list row is built from the Experiment README alone (or the tolerated
// legacy single file): no managed YAML document and no Run is touched, and a
// README is re-read only when its fingerprint changed.

import type { Stats } from 'node:fs'
import { join } from 'node:path'
import {
  BackendExperimentSummarySchema,
  BackendExperimentsResponseSchema,
  buildExperimentRecord,
  EXPERIMENT_DESCRIPTION_FILE,
  EXPERIMENT_DIR_REGEX,
  EXPERIMENT_FILENAME_REGEX,
  type Experiment,
  projectFs as fs,
  type ParsedExperiment,
  type ProjectConfig,
  parseExperimentReadme,
  readExperimentDoc,
  readExperimentManagedDocuments,
} from '@memon/core'
import { digest, type ListedEntry, projectReadIndex, statObservation } from './read-index.js'

const SUMMARY = BackendExperimentSummarySchema

/**
 * The slim list row: identity, the frontmatter fields the list renders,
 * counts instead of the `runs` / `hypotheses` arrays and the Warnings table,
 * parse issues and effective times. No section bodies, no `warningsRaw`, no
 * bundle activity `mtime`; those stay on the detail.
 */
export const BackendExperimentListRowSchema = SUMMARY.omit({
  mtime: true,
  sections: true,
  warningsRaw: true,
  frontMatter: true,
})
  .extend({
    frontMatter: SUMMARY.shape.frontMatter.omit({ runs: true, hypotheses: true }),
    // Non-negative numbers, shaped like the summary's own mtime field.
    runCount: SUMMARY.shape.readmeMtime,
    hypothesisCount: SUMMARY.shape.readmeMtime,
    openWarningCount: SUMMARY.shape.readmeMtime,
  })
  .strict()

export const BackendExperimentListResponseSchema = BackendExperimentsResponseSchema.extend({
  experiments: BackendExperimentListRowSchema.array().max(10_000),
}).strict()

export type BackendExperimentListRow = ReturnType<typeof BackendExperimentListRowSchema.parse>

const EXPERIMENTS_SUBDIR = ['docs', 'experiments'] as const

export interface IndexedExperimentDocument {
  id: string
  /** Absolute README (or legacy file) path. */
  path: string
  parsed: ParsedExperiment
  readmeMtime: number
  counts: ExperimentRowCounts
  /** Discovery warnings added on top of the parsed document's own. */
  discoveryWarnings: ParsedExperiment['parseWarnings']
}

/**
 * The list row's counts. A README seeded from the derived index carries only
 * these (its `hypotheses` and Warnings table are not persisted), so list rows
 * read them from here rather than from `parsed`.
 */
export interface ExperimentRowCounts {
  hypotheses: number
  openWarnings: number
}

/** One parsed Experiment README as the summary index holds it. */
export interface ParsedReadme {
  parsed: ParsedExperiment
  mtime: number
  counts: ExperimentRowCounts
}

/** The summary-index key of an Experiment README (or legacy file). */
export function experimentReadmeKey(path: string, stem: string): string {
  return `file:${path}#experiment-readme:${stem}`
}

function rowCounts(parsed: ParsedExperiment): ExperimentRowCounts {
  return {
    hypotheses: parsed.frontMatter.hypotheses.length,
    openWarnings: parsed.warnings.filter((warning) => warning.status === 'OPEN').length,
  }
}

/** The `docs/experiments/` listing split into folder and legacy-file ids. */
export async function experimentListing(
  project: ProjectConfig,
  maxAgeMs: number,
): Promise<{ folders: Map<string, ListedEntry>; legacy: Map<string, ListedEntry> }> {
  const entries =
    (await projectReadIndex(project.root).listing(
      join(project.root, ...EXPERIMENTS_SUBDIR),
      maxAgeMs,
    )) ?? []
  const folders = new Map<string, ListedEntry>()
  const legacy = new Map<string, ListedEntry>()
  for (const entry of entries) {
    const folder = entry.name.match(EXPERIMENT_DIR_REGEX)
    if (folder && (entry.type === 'dir' || entry.type === 'link')) {
      folders.set(`E${folder[1]}-${folder[2]}`, entry)
      continue
    }
    const file = entry.name.match(EXPERIMENT_FILENAME_REGEX)
    if (file && (entry.type === 'file' || entry.type === 'link')) {
      legacy.set(`E${file[1]}-${file[2]}`, entry)
    }
  }
  return { folders, legacy }
}

/** One Experiment README parsed once per fingerprint (`null` when absent). */
export function indexedExperimentReadme(
  project: ProjectConfig,
  path: string,
  stem: string,
  maxAgeMs: number,
): Promise<ParsedReadme | null> {
  return projectReadIndex(project.root).file(
    path,
    `experiment-readme:${stem}`,
    maxAgeMs,
    (content, stat) => {
      if (!stat.isFile()) return null
      const parsed = parseExperimentReadme(content, stem)
      return { parsed, mtime: stat.mtimeMs, counts: rowCounts(parsed) }
    },
  )
}

/**
 * Every Experiment document as discovery sees it — folder form first, then
 * legacy files without a folder — with the same placeholder and warnings.
 */
export async function indexedExperimentDocuments(
  project: ProjectConfig,
  maxAgeMs: number,
): Promise<IndexedExperimentDocument[]> {
  const { folders, legacy } = await experimentListing(project, maxAgeMs)
  const directory = join(project.root, ...EXPERIMENTS_SUBDIR)
  const fromFolders = await Promise.all(
    [...folders].map(async ([id, entry]): Promise<IndexedExperimentDocument | null> => {
      const path = join(directory, entry.name, 'README.md')
      const readme = await indexedExperimentReadme(project, path, entry.name, maxAgeMs)
      const discoveryWarnings: ParsedExperiment['parseWarnings'] = []
      if (legacy.has(id)) {
        discoveryWarnings.push({
          message: `MIGRATION_COLLISION: a v4 legacy file ${legacy.get(id)!.name} exists alongside the v5 folder ${entry.name}/; the folder is canonical — remove the dangling .md manually`,
          severity: 'warning',
        })
      }
      if (readme) {
        return {
          id,
          path,
          parsed: readme.parsed,
          readmeMtime: readme.mtime,
          counts: readme.counts,
          discoveryWarnings,
        }
      }
      if (entry.type !== 'dir') return null
      const placeholder = parseExperimentReadme('', entry.name)
      placeholder.parseErrors.push({
        message: `MISSING_README: experiment folder ${entry.name}/ has no README.md inside`,
        severity: 'error',
      })
      return {
        id,
        path,
        parsed: placeholder,
        readmeMtime: 0,
        counts: rowCounts(placeholder),
        discoveryWarnings,
      }
    }),
  )
  const fromLegacy = await Promise.all(
    [...legacy]
      .filter(([id]) => !folders.has(id))
      .map(async ([id, entry]): Promise<IndexedExperimentDocument | null> => {
        const path = join(directory, entry.name)
        const stem = entry.name.replace(/\.md$/, '')
        const readme = await indexedExperimentReadme(project, path, stem, maxAgeMs)
        if (!readme) return null
        return {
          id,
          path,
          parsed: readme.parsed,
          readmeMtime: readme.mtime,
          counts: readme.counts,
          discoveryWarnings: [
            {
              message: `LEGACY_LAYOUT: experiment doc is at the v4 file path ${entry.name}; run \`memon-migrate-fs\` to move it into ${stem}/README.md`,
              severity: 'warning',
            },
          ],
        }
      }),
  )
  return [...fromFolders, ...fromLegacy].filter(
    (document): document is IndexedExperimentDocument => document !== null,
  )
}

/** The list row for one indexed Experiment document. */
export function experimentListRow(
  project: ProjectConfig,
  document: IndexedExperimentDocument,
  resource: string,
): BackendExperimentListRow {
  const frontMatter = document.parsed.frontMatter
  return BackendExperimentListRowSchema.parse({
    id: document.id,
    project: project.name,
    resource,
    readmeMtime: document.readmeMtime,
    frontMatter: {
      id: frontMatter.id,
      slug: frontMatter.slug,
      title: frontMatter.title,
      status: frontMatter.status,
      archived: frontMatter.archived,
      tags: frontMatter.tags,
      createdAt: frontMatter.createdAt,
      updatedAt: frontMatter.updatedAt,
    },
    runCount: frontMatter.runs.length,
    hypothesisCount: document.counts.hypotheses,
    openWarningCount: document.counts.openWarnings,
    parseErrors: document.parsed.parseErrors,
    parseWarnings: [...document.parsed.parseWarnings, ...document.discoveryWarnings],
    effectiveCreatedAt: frontMatter.createdAt,
    effectiveUpdatedAt: frontMatter.updatedAt,
  })
}

/** Experiment ids from the listing alone (folders win over legacy files). */
export function experimentIdentities(listing: {
  folders: Map<string, ListedEntry>
  legacy: Map<string, ListedEntry>
}): string[] {
  const ids = new Set<string>()
  for (const [id, entry] of listing.folders) if (entry.type === 'dir') ids.add(id)
  for (const [id, entry] of listing.legacy) if (entry.type === 'file') ids.add(id)
  return [...ids].sort((left, right) => left.localeCompare(right))
}

/**
 * The files whose fingerprints decide whether a cached bundle is re-read: the
 * README, the two YAML sidecars, the FS v9 description file and a leftover
 * `results.yaml` (its presence alone is reported, as `LEGACY_RESULTS_YAML`).
 */
const BUNDLE_FILES = [
  'README.md',
  'implementation.yaml',
  'investigation.yaml',
  EXPERIMENT_DESCRIPTION_FILE,
  'results.yaml',
]
const LEGACY_FILE_OBSERVATION = BUNDLE_FILES.length

/**
 * A full Experiment bundle (README plus managed YAML) as `readExperimentDoc`
 * returns it, re-read only when one of its files' fingerprints changed.
 */
export function indexedExperimentBundle(
  project: ProjectConfig,
  id: string,
  maxAgeMs: number,
): Promise<Experiment | null> {
  if (!EXPERIMENT_DIR_REGEX.test(id)) return Promise.resolve(null)
  const directory = join(project.root, ...EXPERIMENTS_SUBDIR)
  const paths = [
    ...BUNDLE_FILES.map((name) => join(directory, id, name)),
    join(directory, `${id}.md`),
  ]
  return projectReadIndex(project.root).observe<Experiment | null, BundleObservation>(
    `experiment-bundle:${join(directory, id)}`,
    maxAgeMs,
    async () => {
      const observations = await Promise.all(paths.map((path) => statObservation(path)))
      const readme = observations[0]!.fingerprint
      const legacy = observations[LEGACY_FILE_OBSERVATION]!.fingerprint
      if (readme === null && legacy === null) return { fingerprint: null }
      return {
        fingerprint: digest(observations.map((entry) => entry.fingerprint ?? '-')),
        observed: observations.map((entry) => entry.observed ?? null),
      }
    },
    (observed) =>
      observed?.[0]?.isFile()
        ? readObservedBundle(project, id, join(directory, id), observed)
        : readExperimentDoc(project.root, project.name, id),
  ) as Promise<Experiment | null>
}

/** Stats of the bundle files (`BUNDLE_FILES` order) and the legacy single file. */
type BundleObservation = Array<Stats | null>

/**
 * `readExperimentDoc` for a folder whose files were just stat'ed: the same
 * record (documents, effective mtime, migration-collision warning) without
 * stat'ing every file a second time.
 */
async function readObservedBundle(
  project: ProjectConfig,
  id: string,
  folder: string,
  observed: BundleObservation,
): Promise<Experiment> {
  const readmePath = join(folder, 'README.md')
  const [content, documents] = await Promise.all([
    fs.readFile(readmePath, 'utf8'),
    readExperimentManagedDocuments(folder),
  ])
  const parsed = parseExperimentReadme(content, id)
  if (observed[LEGACY_FILE_OBSERVATION]?.isFile()) {
    parsed.parseWarnings.push({
      message: `MIGRATION_COLLISION: a v4 legacy file ${id}.md exists alongside the v5 folder; remove it manually`,
      severity: 'warning',
    })
  }
  const readmeMtime = observed[0]!.mtimeMs
  let documentMtime = 0
  // Bundle activity: the README plus the managed sources (a leftover
  // results.yaml is not one).
  for (const [index, exists] of [
    documents.implementation.exists,
    documents.investigation.exists,
    documents.description?.exists === true,
  ].entries()) {
    const stat = observed[index + 1]
    if (exists && stat) documentMtime = Math.max(documentMtime, stat.mtimeMs)
  }
  return buildExperimentRecord(parsed, {
    id,
    project: project.name,
    path: readmePath,
    mtime: Math.max(readmeMtime, documentMtime),
    readmeMtime,
    documents,
  })
}
