// readRunDir — combine filesystem metadata with a parsed README.md.
//
// When README.md is absent, we synthesize sensible defaults:
//   - id, name from the directory base name
//   - createdAt parsed from the yymmdd-hhmmss tail of the directory name
//     (in the system's local timezone)
//   - status: 'UNKNOWN'
//   - all other required fields empty
//
// hasReadme=false is the signal for "no README" — frontend renders a grayed-out card.

import { basename, join } from '@memon/file-protocol/paths'
import { projectFs as fs } from '../project-file-store.js'
import { parseReadme } from '../readme/parse.js'
import { lightweightRunIdentity, parseRunMetadata, RUN_METADATA_FILE } from '../runs/metadata.js'
import { parseTimestampFromRunDir } from '../time.js'
import type { ParsedReadme, Run } from '../types.js'

export async function readRunDir(dirPath: string, projectName: string): Promise<Run> {
  const id = basename(dirPath)
  const readmePath = join(dirPath, 'README.md')

  const dirStat = await fs.stat(dirPath)
  let mtime = dirStat.mtimeMs
  let readmeMtime = 0

  try {
    const path = join(dirPath, RUN_METADATA_FILE)
    const stat = await fs.stat(path)
    if (!stat.isFile()) return runFromMetadata(dirPath, projectName, '', mtime, stat.mtimeMs)
    return runFromMetadata(
      dirPath,
      projectName,
      await fs.readFile(path, 'utf8'),
      mtime,
      stat.mtimeMs,
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  let hasReadme = false
  let parsed: ParsedReadme

  try {
    const readmeStat = await fs.stat(readmePath)
    readmeMtime = readmeStat.mtimeMs
    if (readmeStat.mtimeMs > mtime) mtime = readmeStat.mtimeMs
    const content = await fs.readFile(readmePath, 'utf8')
    parsed = parseReadme(content)
    hasReadme = true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      parsed = synthesizeFromDirname(id, projectName)
      if (lightweightRunIdentity(dirPath.split('/').slice(-4).join('/'))) {
        parsed.frontMatter.createdAt = ''
        parsed.frontMatter.updatedAt = ''
        parsed.parseWarnings = []
        parsed.parseErrors = [{ message: 'no run.json execution record', severity: 'error' }]
      }
    } else {
      throw err
    }
  }

  // Backfill id from the directory name when front matter omits it. Do NOT
  // backfill `project`: the top-level `project` field on Run carries
  // membership (set from the projectName arg below), so frontMatter.project
  // is now an OPTIONAL sub-project label that we preserve verbatim.
  if (parsed.frontMatter.id === '') parsed.frontMatter.id = id

  // v3 task 3.3: when the README is present but `created_at` is missing or
  // empty, derive it from the run dir name's `yymmdd-hhmmss` tail (same
  // logic the README-absent branch uses). `updated_at` falls back to
  // `created_at` per the parser's existing default. This handles the case
  // where a v2-era README was hand-written without front-matter timestamps —
  // synthesizeFromDirname only fired when the file was missing entirely.
  if (hasReadme && parsed.frontMatter.createdAt === '') {
    const derived = parseTimestampFromRunDir(id)
    if (derived) {
      parsed.frontMatter.createdAt = derived
      if (parsed.frontMatter.updatedAt === '') {
        parsed.frontMatter.updatedAt = derived
      }
    }
  }

  return {
    id: parsed.frontMatter.id || id,
    project: projectName,
    path: dirPath,
    mtime,
    readmeMtime,
    hasReadme,
    recordFormat:
      !hasReadme && lightweightRunIdentity(dirPath.split('/').slice(-4).join('/'))
        ? 'json'
        : 'readme',
    recordPath:
      !hasReadme && lightweightRunIdentity(dirPath.split('/').slice(-4).join('/'))
        ? join(dirPath, RUN_METADATA_FILE)
        : readmePath,
    recordMtime: readmeMtime,
    frontMatter: parsed.frontMatter,
    sections: parsed.sections,
    warnings: parsed.warnings,
    warningsRaw: parsed.warningsRaw,
    body: parsed.body,
    parseErrors: parsed.parseErrors,
    parseWarnings: parsed.parseWarnings,
    frontMatterKeys: parsed.frontMatterKeys,
  }
}

/**
 * `readRunDir` for a README already read: the same id/created_at backfills
 * and record shape, with the caller's stat results. Shared by every index
 * that derives a Run summary from content it already holds.
 */
export function runFromReadme(
  dirPath: string,
  projectName: string,
  content: string,
  dirMtime: number,
  readmeMtime: number,
): Run {
  const id = basename(dirPath)
  const parsed = parseReadme(content)
  if (parsed.frontMatter.id === '') parsed.frontMatter.id = id
  if (parsed.frontMatter.createdAt === '') {
    const derived = parseTimestampFromRunDir(id)
    if (derived) {
      parsed.frontMatter.createdAt = derived
      if (parsed.frontMatter.updatedAt === '') parsed.frontMatter.updatedAt = derived
    }
  }
  return {
    id: parsed.frontMatter.id || id,
    project: projectName,
    path: dirPath,
    mtime: Math.max(dirMtime, readmeMtime),
    readmeMtime,
    hasReadme: true,
    recordFormat: 'readme',
    recordPath: join(dirPath, 'README.md'),
    recordMtime: readmeMtime,
    frontMatter: parsed.frontMatter,
    sections: parsed.sections,
    warnings: parsed.warnings,
    warningsRaw: parsed.warningsRaw,
    body: parsed.body,
    parseErrors: parsed.parseErrors,
    parseWarnings: parsed.parseWarnings,
    frontMatterKeys: parsed.frontMatterKeys,
  }
}

/** JSON records keep the shared display shape, without pretending to contain Markdown. */
export function runFromMetadata(
  dirPath: string,
  projectName: string,
  content: string,
  dirMtime: number,
  metadataMtime: number,
): Run {
  const id = basename(dirPath)
  const { data, issues } = parseRunMetadata(content)
  const empty = synthesizeFromDirname(id, projectName)
  const fm = empty.frontMatter
  // No directory-name or filesystem-time inference for the new record format.
  fm.createdAt = data?.created_at ?? ''
  fm.updatedAt = data?.updated_at ?? fm.createdAt
  fm.name = data?.name ?? id
  fm.id = data?.id ?? id
  fm.status = data?.status ?? 'UNKNOWN'
  fm.startedAt = data?.started_at ?? null
  fm.finishedAt = data?.finished_at ?? null
  fm.host = data?.host ?? null
  fm.pid = data?.pid ?? null
  fm.gpus = data?.gpus ?? []
  fm.entry = data?.entry ?? ''
  fm.command = data?.command ?? ''
  fm.wandb = data?.wandb ?? null
  fm.scheduler = data?.scheduler ?? null
  fm.archived = data?.archived ?? false
  fm.deprecated = data?.active === undefined ? (data?.deprecated ?? false) : !data.active
  if (data && data.id !== id)
    issues.push({
      field: 'id',
      message: 'Run id does not match directory basename',
      severity: 'error',
    })
  return {
    id: fm.id,
    project: projectName,
    path: dirPath,
    mtime: Math.max(dirMtime, metadataMtime),
    readmeMtime: 0,
    hasReadme: false,
    recordFormat: 'json',
    recordPath: join(dirPath, RUN_METADATA_FILE),
    recordMtime: metadataMtime,
    ...(data ? { metadata: data } : {}),
    frontMatter: fm,
    sections: empty.sections,
    warnings: [],
    warningsRaw: null,
    body: '',
    parseErrors: issues,
    parseWarnings: [],
    frontMatterKeys: [...Object.keys(data ?? {}), 'archived'],
  }
}

/**
 * Build a minimal ParsedReadme out of the directory name when README.md is
 * absent. Caller still treats the resulting Run as `hasReadme: false`.
 */
function synthesizeFromDirname(id: string, _projectName: string): ParsedReadme {
  const tail =
    /^(?<name>.+)-(?<yy>\d{2})(?<mm>\d{2})(?<dd>\d{2})-(?<hh>\d{2})(?<mi>\d{2})(?<ss>\d{2})$/.exec(
      id,
    )
  let name = id
  let createdAt = ''
  if (tail?.groups) {
    name = tail.groups.name!
    // Offset in effect at that wall-clock time, so DST boundaries are right.
    createdAt = parseTimestampFromRunDir(id) ?? ''
  }
  return {
    frontMatter: {
      id,
      name,
      // Legacy v2 sub-project label is intentionally empty when README is
      // absent. v3 ignores this field entirely.
      project: '',
      status: 'UNKNOWN',
      createdAt,
      // No README means no parent experiment binding and no edit history.
      experiment: null,
      updatedAt: createdAt,
      finishedAt: null,
      host: null,
      pid: null,
      gpus: [],
      entry: '',
      command: '',
      wandb: null,
      hypotheses: [],
      tags: [],
      // No README means archive state cannot be determined from frontmatter.
      // Default to false; the discovery layer's sidecar fallback (when the
      // dir contains <runDir>/.archived) is applied separately if needed.
      archived: false,
      // Likewise unknowable without a README; absent means not deprecated.
      deprecated: false,
    },
    sections: {
      motivation: null,
      setup: null,
      method: null,
      result: null,
      conclusion: null,
      caveats: null,
      artifacts: [],
      newHypotheses: null,
    },
    warnings: [],
    warningsRaw: null,
    body: '',
    parseErrors: [],
    parseWarnings: [
      {
        message: 'no README.md (synthesized id/name/created_at from directory name)',
        severity: 'warning',
      },
    ],
    // No frontmatter block at all, so no declared keys.
    frontMatterKeys: [],
  }
}
