// parseExperimentReadme — turn the raw markdown content of a v5 experiment
// doc (`docs/experiments/E<NNNN>-<slug>/README.md`) into a structured record.
//
// Behavior:
//   1. Split front matter (YAML between `---`) from body via gray-matter
//   2. Validate front matter shape with zod (loose) and convert snake_case → camelCase
//   3. Split body into ## H2 sections; capture
//      Motivation/Method/Plan/Conclusion/Caveats/Warnings
//   4. Warnings section is preserved as `warningsRaw` for now; structured
//      parsing of the 7-column table lives in a later task.
//   5. Collect all parse issues, including `UNKNOWN_H2_SECTION` warnings
//      for any non-canonical H2 heading.

import matter from 'gray-matter'
import type { ZodError } from 'zod'

import { RUN_DIR_REGEX } from '../ids.js'
import { stringArray, stringOr, validatedHypothesisRefs } from '../readme/fields.js'
import { splitH2Sections } from '../readme/sections.js'
import { ExperimentFrontMatterRawSchema } from '../schemas.js'
import { normalizeExperimentStatus } from '../status.js'
import {
  EXPERIMENT_DIR_REGEX,
  type Experiment,
  type ExperimentFrontMatter,
  type ExperimentManagedDocuments,
  type ExperimentRawSection,
  type ExperimentSections,
  type ExperimentWarningRecord,
  type ParseIssue,
} from '../types.js'
import { matterOptions } from '../yaml-engine.js'
import {
  CANONICAL_EXPERIMENT_SECTION_HEADINGS,
  MANAGED_EXPERIMENT_SECTIONS,
  MANAGED_SECTION_HEADINGS,
  MANAGED_SECTION_POINTERS,
} from './documents.js'

export interface ParsedExperiment {
  frontMatter: ExperimentFrontMatter
  sections: ExperimentSections
  rawSections: ExperimentRawSection[]
  warnings: ExperimentWarningRecord[]
  warningsRaw: string | null
  body: string
  parseErrors: ParseIssue[]
  parseWarnings: ParseIssue[]
}

/**
 * Parse a v5 experiment doc's markdown content. Caller supplies the
 * experiment id (`E<NNNN>-<slug>`, matching the enclosing folder name) so
 * the parser can cross-check `id` and `slug` against it.
 *
 * The second parameter is kept positional + named `filenameStem` for
 * back-compat with v4 call sites; in v5 it is the folder basename
 * (e.g. `E0001-zero-snr-fix`).
 */
export function parseExperimentReadme(content: string, filenameStem: string): ParsedExperiment {
  const errors: ParseIssue[] = []
  const warnings: ParseIssue[] = []

  // Cross-check folder name (v5) or filename stem (legacy v4) against
  // E<NNNN>-<slug> shape.
  const fnameMatch = filenameStem.match(EXPERIMENT_DIR_REGEX)
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

  // v4-added: ExperimentStatus. Missing → OPEN with parse warning.
  let status: ExperimentFrontMatter['status']
  if (raw.status === undefined) {
    status = 'OPEN'
    warnings.push({
      field: 'status',
      message: `MISSING_EXP_STATUS: experiment status missing from frontmatter; defaulting to OPEN`,
      severity: 'warning',
    })
  } else {
    const result = normalizeExperimentStatus(raw.status)
    status = result.value
    if (result.issue) {
      if (result.issue.severity === 'error') errors.push(result.issue)
      else warnings.push(result.issue)
    }
  }

  // v4-added: archived flag. Missing → false with parse warning.
  let archived = false
  if (raw.archived === undefined) {
    warnings.push({
      field: 'archived',
      message: `MISSING_ARCHIVED_FIELD: archived flag missing from frontmatter; defaulting to false`,
      severity: 'warning',
    })
  } else if (typeof raw.archived === 'boolean') {
    archived = raw.archived
  } else {
    warnings.push({
      field: 'archived',
      message: `archived must be a boolean; received ${typeof raw.archived}; defaulting to false`,
      severity: 'warning',
    })
  }

  const frontMatter: ExperimentFrontMatter = {
    id: fnameId ?? declaredId,
    slug: fnameSlug ?? declaredSlug,
    title: stringOr(raw.title, ''),
    status,
    archived,
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
    design: getSection('Design'),
    implementation: getSection('Implementation'),
    investigation: getSection('Investigation'),
    results: getSection('Results'),
    findings: getSection('Findings'),
    limitations: getSection('Limitations'),
    conclusion: getSection('Conclusion'),
    // Compatibility projections for old clients. These headings are not
    // canonical in v6 and are still surfaced as unsupported raw sections.
    method: getSection('Method'),
    plan: getSection('Plan'),
    caveats: getSection('Caveats'),
  }

  const canonical = new Set<string>(CANONICAL_EXPERIMENT_SECTION_HEADINGS)
  const managedByHeading = new Map<string, (typeof MANAGED_EXPERIMENT_SECTIONS)[number]>(
    MANAGED_EXPERIMENT_SECTIONS.map((kind) => [MANAGED_SECTION_HEADINGS[kind], kind]),
  )
  const rawSections: ExperimentRawSection[] = split.entries.map((entry) => {
    const managedKind = managedByHeading.get(entry.heading)
    return {
      ...entry,
      supported: canonical.has(entry.heading),
      managed: managedKind !== undefined,
      pointerValid:
        managedKind === undefined
          ? null
          : entry.body.trim() === MANAGED_SECTION_POINTERS[managedKind] &&
            entry.body.trim().split(/\r?\n/).length === 1,
    }
  })

  // Warnings section is preserved as raw for now; structured parsing comes
  // with the 7-column table update in a follow-up task.
  const warningsBody = split.sections.get('Warnings') ?? null
  const warningsRaw = warningsBody && warningsBody.trim() !== '' ? warningsBody : null

  // Surface non-canonical sections (anything not in the 6 standard ones).
  // v5: every non-canonical heading produces an explicit `UNKNOWN_H2_SECTION`
  // parse warning so doctor / digest / web `parse_warnings` can flag them.
  for (const section of rawSections) {
    const heading = section.heading
    if (!section.supported) {
      // Method/Plan/Caveats are a recognised v5 compatibility shape. They
      // remain unsupported (strict lint reports them), but ordinary tolerant
      // reads do not add noise beyond `rawSections.supported = false`.
      if (heading === 'Method' || heading === 'Plan' || heading === 'Caveats') {
        // Continue with duplicate checks below.
      } else {
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
          message: `UNKNOWN_H2_SECTION: heading "## ${heading}" is not in the canonical experiment doc section list; content is preserved verbatim but not categorised`,
          severity: 'warning',
        })
      }
    }
    if (section.occurrence > 1) {
      warnings.push({
        field: `section.${heading}`,
        message: `DUPLICATE_H2_SECTION: heading "## ${heading}" occurs more than once; every occurrence is preserved for compatibility rendering`,
        severity: 'warning',
      })
    }
    if (section.managed && !section.pointerValid) {
      const kind = managedByHeading.get(heading)!
      warnings.push({
        field: `section.${heading}`,
        message: `MANAGED_SECTION_NOT_STUB: "## ${heading}" must contain exactly: ${MANAGED_SECTION_POINTERS[kind]}; original content is preserved`,
        severity: 'warning',
      })
    }
  }

  return {
    frontMatter,
    sections,
    rawSections,
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
  meta: {
    id: string
    project: string
    path: string
    mtime: number
    /** README-only lock time; defaults to mtime for compatibility callers. */
    readmeMtime?: number
    documents?: ExperimentManagedDocuments | null
  },
): Experiment {
  return {
    id: meta.id,
    project: meta.project,
    path: meta.path,
    mtime: meta.mtime,
    readmeMtime: meta.readmeMtime ?? meta.mtime,
    frontMatter: parsed.frontMatter,
    sections: parsed.sections,
    rawSections: parsed.rawSections,
    documents: meta.documents ?? null,
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
      status: 'OPEN',
      archived: false,
      runs: [],
      hypotheses: [],
      tags: [],
      createdAt: '',
      updatedAt: '',
    },
    sections: {
      motivation: null,
      design: null,
      implementation: null,
      investigation: null,
      results: null,
      findings: null,
      limitations: null,
      conclusion: null,
      method: null,
      plan: null,
      caveats: null,
    },
    rawSections: [],
    warnings: [],
    warningsRaw: null,
    body,
    parseErrors: errors,
    parseWarnings: warnings,
  }
}

function validatedRunRefs(v: unknown, warnings: ParseIssue[]): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const elem of v) {
    if (typeof elem !== 'string') continue
    if (
      RUN_DIR_REGEX.test(elem) &&
      !/[\\\0]/.test(elem) &&
      elem.split('/').every((part) => part !== '.' && part !== '..' && part !== '')
    ) {
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
