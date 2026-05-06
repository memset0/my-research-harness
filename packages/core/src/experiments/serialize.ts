// Serialize a v3 experiment doc back to markdown.
//
// Section ordering is canonical (Motivation/Method/Conclusion/Caveats/
// Warnings). Empty/null sections produce an H2 heading with empty body so
// editors round-trip cleanly. The Warnings section, when supplied as raw
// markdown, is emitted verbatim — this writer does NOT re-render the
// table. Use the section-bound writer (later task) for structured
// warning mutations.

import type {
  ExperimentFrontMatter,
  ExperimentSections,
} from '../types.js'
import { isId } from '../ids.js'

const SECTION_ORDER = ['motivation', 'method', 'conclusion', 'caveats'] as const
const HEADING_FOR: Record<(typeof SECTION_ORDER)[number] | 'warnings', string> = {
  motivation: 'Motivation',
  method: 'Method',
  conclusion: 'Conclusion',
  caveats: 'Caveats',
  warnings: 'Warnings',
}

export interface SerializeExperimentInput {
  frontMatter: ExperimentFrontMatter
  sections: ExperimentSections
  /** Raw markdown for the Warnings section body, or null/empty to omit. */
  warningsRaw?: string | null
}

export function serializeExperimentReadme(input: SerializeExperimentInput): string {
  const fmYaml = renderFrontMatter(input.frontMatter)
  const bodyParts: string[] = []
  for (const key of SECTION_ORDER) {
    bodyParts.push(`## ${HEADING_FOR[key]}`)
    const value = input.sections[key]
    if (value && value.trim() !== '') bodyParts.push(value.trim())
    bodyParts.push('')
  }
  // Warnings section
  bodyParts.push(`## ${HEADING_FOR.warnings}`)
  const warningsBody = input.warningsRaw && input.warningsRaw.trim() !== ''
    ? input.warningsRaw.trim()
    : ''
  if (warningsBody) bodyParts.push(warningsBody)
  bodyParts.push('')
  return `---\n${fmYaml}---\n\n${bodyParts.join('\n').trimEnd()}\n`
}

function renderFrontMatter(fm: ExperimentFrontMatter): string {
  const lines: string[] = []
  lines.push(`id: ${quoteIfNeeded(fm.id)}`)
  lines.push(`slug: ${quoteIfNeeded(fm.slug)}`)
  lines.push(`title: ${quoteIfNeeded(fm.title)}`)
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
  if (/[:#&*!|>'"%@`,\[\]\{\}]/.test(value)) return JSON.stringify(value)
  if (/^(true|false|null|~|yes|no|on|off)$/i.test(value)) return JSON.stringify(value)
  if (/^-?\d/.test(value)) return JSON.stringify(value)
  if (value.startsWith(' ') || value.endsWith(' ')) return JSON.stringify(value)
  return value
}

function renderStringArray(arr: string[]): string {
  if (arr.length === 0) return '[]'
  return `[${arr.map(quoteIfNeeded).join(', ')}]`
}
