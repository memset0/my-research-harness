// parseReadme — turn raw README.md content into a ParsedReadme.
//
// Behavior:
//   1. Split front matter (YAML between `---`) from body via gray-matter
//   2. Validate front matter shape with zod (loose) and convert snake_case → camelCase
//   3. Normalize status via normalizeStatus
//   4. Split body into ## H2 sections; capture standard 8 sections
//   5. Parse the Artifacts section body into structured entries
//   6. Collect all parse issues (errors prevent indexing as "valid"; warnings don't)

import matter from 'gray-matter'
import { ZodError } from 'zod'
import type {
  ExperimentFrontMatter,
  ExperimentSections,
  ParseIssue,
  ParsedReadme,
} from '../types.js'
import { ExperimentFrontMatterRawSchema } from '../schemas.js'
import { normalizeStatus } from '../status.js'
import { matterOptions } from '../yaml-engine.js'
import { parseArtifacts } from './artifacts.js'
import { splitH2Sections } from './sections.js'

const STANDARD_SECTIONS = [
  'Motivation',
  'Setup',
  'Method',
  'Result',
  'Conclusion',
  'Caveats',
  'Artifacts',
  'New Hypotheses',
] as const

export function parseReadme(content: string): ParsedReadme {
  const errors: ParseIssue[] = []
  const warnings: ParseIssue[] = []

  let parsed: ReturnType<typeof matter>
  try {
    parsed = matter(content, matterOptions)
  } catch (err) {
    errors.push({
      message: `failed to parse YAML front matter: ${(err as Error).message}`,
      severity: 'error',
    })
    return emptyResult(errors, warnings, content)
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
    return emptyResult(errors, warnings, body)
  }

  if (!validated.success) {
    for (const issue of (validated.error as ZodError).issues) {
      errors.push({
        field: issue.path.join('.') || undefined,
        message: issue.message,
        severity: 'error',
      })
    }
    // Even if validation failed, we still try to recover what we can
  }

  const raw = (validated.success ? validated.data : (rawData as Record<string, unknown>)) as Record<
    string,
    unknown
  >

  // Status normalization (always runs, regardless of zod outcome)
  const statusResult = normalizeStatus(raw.status)
  if (statusResult.issue) {
    if (statusResult.issue.severity === 'error') {
      errors.push(statusResult.issue)
    } else {
      warnings.push(statusResult.issue)
    }
  }

  const frontMatter: ExperimentFrontMatter = {
    id: stringOr(raw.id, ''),
    name: stringOr(raw.name, ''),
    project: stringOr(raw.project, ''),
    status: statusResult.value,
    createdAt: stringOr(raw.created_at, ''),
    finishedAt: nullableString(raw.finished_at),
    host: nullableString(raw.host),
    pid: nullableNumber(raw.pid),
    gpus: numberArray(raw.gpus),
    entry: stringOr(raw.entry, ''),
    command: stringOr(raw.command, ''),
    wandb: nullableString(raw.wandb),
    hypotheses: stringArray(raw.hypotheses),
    tags: stringArray(raw.tags),
  }

  // Split body into sections
  const split = splitH2Sections(body)
  const sections: ExperimentSections = {
    motivation: getSection(split.sections, 'Motivation'),
    setup: getSection(split.sections, 'Setup'),
    method: getSection(split.sections, 'Method'),
    result: getSection(split.sections, 'Result'),
    conclusion: getSection(split.sections, 'Conclusion'),
    caveats: getSection(split.sections, 'Caveats'),
    artifacts: parseArtifacts(getSection(split.sections, 'Artifacts') ?? ''),
    newHypotheses: getSection(split.sections, 'New Hypotheses'),
  }

  // Warn on unknown sections
  for (const heading of split.order) {
    if (!STANDARD_SECTIONS.includes(heading as (typeof STANDARD_SECTIONS)[number])) {
      warnings.push({
        field: `section.${heading}`,
        message: `unknown section "${heading}" (not in standard schema)`,
        severity: 'warning',
      })
    }
  }

  return {
    frontMatter,
    sections,
    body,
    parseErrors: errors,
    parseWarnings: warnings,
  }
}

// ---------- helpers ----------

function emptyResult(errors: ParseIssue[], warnings: ParseIssue[], body: string): ParsedReadme {
  return {
    frontMatter: {
      id: '',
      name: '',
      project: '',
      status: 'UNKNOWN',
      createdAt: '',
      finishedAt: null,
      host: null,
      pid: null,
      gpus: [],
      entry: '',
      command: '',
      wandb: null,
      hypotheses: [],
      tags: [],
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
    body,
    parseErrors: errors,
    parseWarnings: warnings,
  }
}

function stringOr(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback
}

function nullableString(v: unknown): string | null {
  if (v === null || v === undefined) return null
  return typeof v === 'string' ? v : null
}

function nullableNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function numberArray(v: unknown): number[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
}

function stringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string')
}

function getSection(sections: Map<string, string>, heading: string): string | null {
  const value = sections.get(heading)
  if (value === undefined) return null
  return value
}
