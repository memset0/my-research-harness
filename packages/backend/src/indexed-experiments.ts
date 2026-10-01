// Experiment list rows and identities served from the Project summary index.
//
// A list row is built from the Experiment README alone (or the tolerated
// legacy single file): no managed YAML document and no Run is touched, and a
// README is re-read only when its fingerprint changed.

import { join } from 'node:path'
import {
  BackendExperimentSummarySchema,
  BackendExperimentsResponseSchema,
  EXPERIMENT_DIR_REGEX,
  EXPERIMENT_FILENAME_REGEX,
  type ParsedExperiment,
  type ProjectConfig,
  parseExperimentReadme,
} from '@memon/core'
import { type ListedEntry, projectReadIndex } from './read-index.js'

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
  /** Discovery warnings added on top of the parsed document's own. */
  discoveryWarnings: ParsedExperiment['parseWarnings']
}

interface ParsedReadme {
  parsed: ParsedExperiment
  mtime: number
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
    (content, stat) =>
      stat.isFile() ? { parsed: parseExperimentReadme(content, stem), mtime: stat.mtimeMs } : null,
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
        return { id, path, parsed: readme.parsed, readmeMtime: readme.mtime, discoveryWarnings }
      }
      if (entry.type !== 'dir') return null
      const placeholder = parseExperimentReadme('', entry.name)
      placeholder.parseErrors.push({
        message: `MISSING_README: experiment folder ${entry.name}/ has no README.md inside`,
        severity: 'error',
      })
      return { id, path, parsed: placeholder, readmeMtime: 0, discoveryWarnings }
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
    hypothesisCount: frontMatter.hypotheses.length,
    openWarningCount: document.parsed.warnings.filter((warning) => warning.status === 'OPEN')
      .length,
    parseErrors: document.parsed.parseErrors,
    parseWarnings: [...document.parsed.parseWarnings, ...document.discoveryWarnings],
    effectiveCreatedAt: frontMatter.createdAt,
    effectiveUpdatedAt: frontMatter.updatedAt,
  })
}
