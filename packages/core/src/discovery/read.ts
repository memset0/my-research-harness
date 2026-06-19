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

import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import { parseReadme } from '../readme/parse.js'
import { parseTimestampFromRunDir } from '../time.js'
import type { Run, ParsedReadme } from '../types.js'

export async function readRunDir(
  dirPath: string,
  projectName: string,
): Promise<Run> {
  const id = basename(dirPath)
  const readmePath = join(dirPath, 'README.md')

  const dirStat = await fs.stat(dirPath)
  let mtime = dirStat.mtimeMs
  let readmeMtime = 0

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
    frontMatter: parsed.frontMatter,
    sections: parsed.sections,
    warnings: parsed.warnings,
    warningsRaw: parsed.warningsRaw,
    body: parsed.body,
    parseErrors: parsed.parseErrors,
    parseWarnings: parsed.parseWarnings,
  }
}

/**
 * Build a minimal ParsedReadme out of the directory name when README.md is
 * absent. Caller still treats the resulting Run as `hasReadme: false`.
 */
function synthesizeFromDirname(id: string, _projectName: string): ParsedReadme {
  const tail = /^(?<name>.+)-(?<yy>\d{2})(?<mm>\d{2})(?<dd>\d{2})-(?<hh>\d{2})(?<mi>\d{2})(?<ss>\d{2})$/.exec(
    id,
  )
  let name = id
  let createdAt = ''
  if (tail?.groups) {
    name = tail.groups.name!
    const yy = tail.groups.yy!
    const mm = tail.groups.mm!
    const dd = tail.groups.dd!
    const hh = tail.groups.hh!
    const mi = tail.groups.mi!
    const ss = tail.groups.ss!
    createdAt = `20${yy}-${mm}-${dd}T${hh}:${mi}:${ss}${getLocalOffset()}`
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
      { message: 'no README.md (synthesized id/name/created_at from directory name)', severity: 'warning' },
    ],
  }
}

function getLocalOffset(): string {
  const offsetMin = -new Date().getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMin)
  const hh = String(Math.floor(abs / 60)).padStart(2, '0')
  const mm = String(abs % 60).padStart(2, '0')
  return `${sign}${hh}:${mm}`
}
