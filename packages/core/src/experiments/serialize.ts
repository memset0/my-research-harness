import { isId } from '../ids.js'
import type { ExperimentFrontMatter, ExperimentRawSection, ExperimentSections } from '../types.js'
import { CANONICAL_EXPERIMENT_SECTION_HEADINGS, MANAGED_SECTION_POINTERS } from './documents.js'

export interface SerializeExperimentInput {
  frontMatter: ExperimentFrontMatter
  sections: ExperimentSections
  /** Raw markdown for the Warnings section body, or null/empty to omit. */
  warningsRaw?: string | null
  /**
   * Preserve these H2 occurrences verbatim and in order. This is used by
   * metadata-only mutations so unsupported/duplicate legacy content cannot
   * be lost. Canonical v6 creation should omit it.
   */
  rawSections?: ExperimentRawSection[]
  /** Exact body (everything after frontmatter) for metadata-only rewrites. */
  rawBody?: string
  /** Internal migration compatibility; new documents must use v6. */
  sectionLayout?: 'v6' | 'v5'
}

export function serializeExperimentReadme(input: SerializeExperimentInput): string {
  const fmYaml = renderFrontMatter(input.frontMatter)
  if (input.rawBody !== undefined) {
    const separator = input.rawBody.startsWith('\n') ? '' : '\n\n'
    const content = `---\n${fmYaml}---${separator}${input.rawBody}`
    return content.endsWith('\n') ? content : `${content}\n`
  }
  const hasLegacySectionContent = [
    input.sections.method,
    input.sections.plan,
    input.sections.caveats,
  ].some((value) => value !== null && value !== undefined)
  const layout = input.sectionLayout ?? (hasLegacySectionContent ? 'v5' : 'v6')
  const body = input.rawSections
    ? renderRawSections(input.rawSections)
    : layout === 'v5'
      ? renderV5Sections(input.sections, input.warningsRaw)
      : renderV6Sections(input.sections, input.warningsRaw)
  return `---\n${fmYaml}---\n\n${body.trimEnd()}\n`
}

function renderV6Sections(
  sections: ExperimentSections,
  warningsRaw: string | null | undefined,
): string {
  const bodies: Record<(typeof CANONICAL_EXPERIMENT_SECTION_HEADINGS)[number], string | null> = {
    Motivation: sections.motivation,
    Design: sections.design ?? null,
    Implementation: MANAGED_SECTION_POINTERS.implementation,
    Investigation: MANAGED_SECTION_POINTERS.investigation,
    Results: MANAGED_SECTION_POINTERS.results,
    Findings: sections.findings ?? null,
    Limitations: sections.limitations ?? null,
    Conclusion: sections.conclusion,
    Warnings: warningsRaw ?? null,
  }
  return CANONICAL_EXPERIMENT_SECTION_HEADINGS.map((heading) =>
    renderSection(heading, bodies[heading]),
  ).join('\n')
}

function renderV5Sections(
  sections: ExperimentSections,
  warningsRaw: string | null | undefined,
): string {
  return [
    renderSection('Motivation', sections.motivation),
    renderSection('Method', sections.method),
    renderSection('Plan', sections.plan),
    renderSection('Conclusion', sections.conclusion),
    renderSection('Caveats', sections.caveats),
    renderSection('Warnings', warningsRaw ?? null),
  ].join('\n')
}

function renderRawSections(rawSections: ExperimentRawSection[]): string {
  return rawSections.map((section) => renderSection(section.heading, section.body)).join('\n')
}

function renderSection(heading: string, body: string | null): string {
  const trimmed = body?.trim() ?? ''
  return `## ${heading}\n${trimmed}${trimmed ? '\n' : ''}`
}

function renderFrontMatter(fm: ExperimentFrontMatter): string {
  const lines: string[] = []
  lines.push(`id: ${quoteIfNeeded(fm.id)}`)
  lines.push(`slug: ${quoteIfNeeded(fm.slug)}`)
  lines.push(`title: ${quoteIfNeeded(fm.title)}`)
  lines.push(`status: ${fm.status}`)
  lines.push(`archived: ${fm.archived ? 'true' : 'false'}`)
  lines.push(`runs: ${renderStringArray(fm.runs)}`)
  for (const ref of fm.hypotheses) {
    if (!isId(ref, 'H')) {
      throw new Error(
        `serializeExperimentReadme: hypotheses[] element "${ref}" is not canonical (expected H<NNNN>)`,
      )
    }
  }
  lines.push(`hypotheses: ${renderStringArray(fm.hypotheses)}`)
  lines.push(`tags: ${renderStringArray(fm.tags)}`)
  lines.push(`created_at: ${quoteIfNeeded(fm.createdAt)}`)
  lines.push(`updated_at: ${quoteIfNeeded(fm.updatedAt)}`)
  return `${lines.join('\n')}\n`
}

function quoteIfNeeded(value: string): string {
  if (value === '') return "''"
  if (/[:#&*!|>'"%@`,[\]{}]/.test(value)) return JSON.stringify(value)
  if (/^(true|false|null|~|yes|no|on|off)$/i.test(value)) return JSON.stringify(value)
  if (/^-?\d/.test(value)) return JSON.stringify(value)
  if (value.startsWith(' ') || value.endsWith(' ')) return JSON.stringify(value)
  return value
}

function renderStringArray(arr: string[]): string {
  if (arr.length === 0) return '[]'
  return `[${arr.map(quoteIfNeeded).join(', ')}]`
}
