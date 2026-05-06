// parseExperimentReadme — turn the raw markdown content of a v3 experiment
// doc (`docs/experiments/E<NNNN>-<slug>.md`) into a structured record.
//
// Behavior:
//   1. Split front matter (YAML between `---`) from body via gray-matter
//   2. Validate front matter shape with zod (loose) and convert snake_case → camelCase
//   3. Split body into ## H2 sections; capture
//      Motivation/Method/Conclusion/Caveats/Warnings
//   4. Warnings section is preserved as `warningsRaw` for now; structured
//      parsing of the 7-column table lives in a later task.
//   5. Collect all parse issues.

import matter from 'gray-matter'
import { ZodError } from 'zod'

import { isId } from '../ids.js'
import {
  type Experiment,
  type ExperimentFrontMatter,
  type ExperimentSections,
  type ExperimentWarningRecord,
  type ParseIssue,
  EXPERIMENT_FILENAME_REGEX,
} from '../types.js'
import { ExperimentFrontMatterRawSchema } from '../schemas.js'
import { matterOptions } from '../yaml-engine.js'
import { splitH2Sections } from '../readme/sections.js'

const STANDARD_EXPERIMENT_SECTIONS = [
  'Motivation',
  'Method',
  'Conclusion',
  'Caveats',
  'Warnings',
] as const

export interface ParsedExperiment {
  frontMatter: ExperimentFrontMatter
  sections: ExperimentSections
  warnings: ExperimentWarningRecord[]
  warningsRaw: string | null
  body: string
  parseErrors: ParseIssue[]
  parseWarnings: ParseIssue[]
}

/**
 * Parse a v3 experiment doc's markdown content. Caller supplies the
 * filename (without extension, e.g. `E0001-zero-snr-fix`) so the parser can
 * cross-check `id` and `slug` against the file basename.
 */
export function parseExperimentReadme(
  content: string,
  filenameStem: string,
): ParsedExperiment {
  const errors: ParseIssue[] = []
  const warnings: ParseIssue[] = []

  // Cross-check filename against E<NNNN>-<slug> shape.
  const fnameMatch = `${filenameStem}.md`.match(EXPERIMENT_FILENAME_REGEX)
  const fnameId = fnameMatch ? `E${fnameMatch[1]}-${fnameMatch[2]}` : null
  const fnameSlug = fnameMatch ? fnameMatch[2]! : null

  let parsed: ReturnType<typeof matter>
  try {
    parsed = matter(content, matterOptions)
  } catch (err) {
    errors.push({
      message: `failed to parse YAML front matter: ${(err as Error).message}`,
      severity: 'error',
    })
    return emptyResult(errors, warnings, content, fnameId, fnameSlug)
  }

  const rawData = parsed.data
  const body = parsed.content

  let validated: ReturnType<typeof ExperimentFrontMatterRawSchema.safeParse>
  try {
    validated = ExperimentFrontMatterRawSchema.safeParse(rawData)
  } catch (err) {
    errors.push({
      message: `front matter validation crashed: ${(err as Error).message}`,
      severity: 'error',
    })
    return emptyResult(errors, warnings, body, fnameId, fnameSlug)
  }

  if (!validated.success) {
    for (const issue of (validated.error as ZodError).issues) {
      errors.push({
        field: issue.path.join('.') || undefined,
        message: issue.message,
        severity: 'error',
      })
    }
  }

  const raw = (validated.success ? validated.data : (rawData as Record<string, unknown>)) as Record<
    string,
    unknown
  >

  // Filename ↔ id sanity
  const declaredId = stringOr(raw.id, '')
  const declaredSlug = stringOr(raw.slug, '')
  if (fnameId && declaredId && declaredId !== fnameId) {
    errors.push({
      field: 'id',
      message: `id mismatch with filename: file is ${fnameId} but frontmatter says ${declaredId}`,
      severity: 'error',
    })
  }
  if (fnameSlug && declaredSlug && declaredSlug !== fnameSlug) {
    errors.push({
      field: 'slug',
      message: `slug mismatch with filename: file is ${fnameSlug} but frontmatter says ${declaredSlug}`,
      severity: 'error',
    })
  }

  // Validate run dir refs in `runs[]` (drop bad ones with warnings)
  const runs = validatedRunRefs(raw.runs, warnings)

  // Validate hypothesis refs (drop bad ones with warnings)
  const hypotheses = validatedHypothesisRefs(raw.hypotheses, warnings)

  const frontMatter: ExperimentFrontMatter = {
    id: fnameId ?? declaredId,
    slug: fnameSlug ?? declaredSlug,
    title: stringOr(raw.title, ''),
    runs,
    hypotheses,
    tags: stringArray(raw.tags),
    createdAt: stringOr(raw.created_at, ''),
    updatedAt: stringOr(raw.updated_at, ''),
  }

  // Split body into sections
  const split = splitH2Sections(body)
  const getSection = (name: string): string | null =>
    (split.sections.get(name) ?? '').trim() || null

  const sections: ExperimentSections = {
    motivation: getSection('Motivation'),
    method: getSection('Method'),
    conclusion: getSection('Conclusion'),
    caveats: getSection('Caveats'),
  }

  // Warnings section is preserved as raw for now; structured parsing comes
  // with the 7-column table update in a follow-up task.
  const warningsBody = split.sections.get('Warnings') ?? null
  const warningsRaw = warningsBody && warningsBody.trim() !== '' ? warningsBody : null

  // Surface non-canonical sections (anything not in the 5 standard ones)
  for (const heading of split.order) {
    if (
      !STANDARD_EXPERIMENT_SECTIONS.includes(
        heading as (typeof STANDARD_EXPERIMENT_SECTIONS)[number],
      )
    ) {
      // Carry-over from v2: the legacy `New Hypotheses` section is no longer
      // part of the experiment doc schema. Surface a structured warning so
      // the user moves the content into Motivation / Conclusion.
      if (heading === 'New Hypotheses') {
        warnings.push({
          field: 'section.New Hypotheses',
          message:
            'legacy `## New Hypotheses` section in experiment doc — relocate into Motivation/Conclusion',
          severity: 'warning',
        })
        continue
      }
      warnings.push({
        field: `section.${heading}`,
        message: `unknown section "${heading}" (not in experiment doc schema)`,
        severity: 'warning',
      })
    }
  }

  return {
    frontMatter,
    sections,
    warnings: [], // structured parsing TBD
    warningsRaw,
    body,
    parseErrors: errors,
    parseWarnings: warnings,
  }
}

/**
 * Build an `Experiment` record from a parsed experiment doc by adding the
 * disk metadata (path, mtime) and the membership project (set by discovery
 * from `config.yml`).
 */
export function buildExperimentRecord(
  parsed: ParsedExperiment,
  meta: { id: string; project: string; path: string; mtime: number },
): Experiment {
  return {
    id: meta.id,
    project: meta.project,
    path: meta.path,
    mtime: meta.mtime,
    frontMatter: parsed.frontMatter,
    sections: parsed.sections,
    warnings: parsed.warnings,
    warningsRaw: parsed.warningsRaw,
    body: parsed.body,
    parseErrors: parsed.parseErrors,
    parseWarnings: parsed.parseWarnings,
  }
}

// ---------- helpers ----------

function emptyResult(
  errors: ParseIssue[],
  warnings: ParseIssue[],
  body: string,
  fnameId: string | null,
  fnameSlug: string | null,
): ParsedExperiment {
  return {
    frontMatter: {
      id: fnameId ?? '',
      slug: fnameSlug ?? '',
      title: '',
      runs: [],
      hypotheses: [],
      tags: [],
      createdAt: '',
      updatedAt: '',
    },
    sections: {
      motivation: null,
      method: null,
      conclusion: null,
      caveats: null,
    },
    warnings: [],
    warningsRaw: null,
    body,
    parseErrors: errors,
    parseWarnings: warnings,
  }
}

function stringOr(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback
}

function stringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string')
}

const RUN_DIR_RE = /^.+-\d{6}-\d{6}$/

function validatedRunRefs(v: unknown, warnings: ParseIssue[]): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const elem of v) {
    if (typeof elem !== 'string') continue
    if (RUN_DIR_RE.test(elem)) {
      out.push(elem)
    } else {
      warnings.push({
        field: 'runs',
        message: `INVALID_RUN_REF: "${elem}" does not match run-dir regex`,
        severity: 'warning',
      })
    }
  }
  return out
}

function validatedHypothesisRefs(v: unknown, warnings: ParseIssue[]): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const elem of v) {
    if (typeof elem !== 'string') continue
    if (isId(elem, 'H')) {
      out.push(elem)
    } else {
      warnings.push({
        field: 'hypotheses',
        message: `INVALID_HYPOTHESIS_REF: "${elem}" is not canonical H<NNNN>`,
        severity: 'warning',
      })
    }
  }
  return out
}
