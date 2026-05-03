// serializeReadme — turn a ParsedReadme back into raw markdown.
//
// Section ordering is canonical (Motivation/Setup/Method/Result/Conclusion/
// Caveats/Artifacts/(opt)New Hypotheses). Empty/null sections produce a
// heading with an empty body rather than being omitted, so that:
//   - editors round-trip cleanly
//   - the user can fill in a placeholder section without renaming/reordering
//
// The Artifacts section is regenerated from the structured entries, so any
// extra prose in that section is dropped — agents writing free-form Artifacts
// text should put it in another section.

import type {
  ArtifactEntry,
  ExperimentFrontMatter,
  ExperimentSections,
  ParsedReadme,
} from '../types.js'

const SECTION_ORDER: ReadonlyArray<keyof Omit<ExperimentSections, 'artifacts'> | 'artifacts'> = [
  'motivation',
  'setup',
  'method',
  'result',
  'conclusion',
  'caveats',
  'artifacts',
  'newHypotheses',
]

const HEADING_FOR: Record<(typeof SECTION_ORDER)[number], string> = {
  motivation: 'Motivation',
  setup: 'Setup',
  method: 'Method',
  result: 'Result',
  conclusion: 'Conclusion',
  caveats: 'Caveats',
  artifacts: 'Artifacts',
  newHypotheses: 'New Hypotheses',
}

export interface SerializeReadmeInput {
  frontMatter: ExperimentFrontMatter
  sections: ExperimentSections
  /**
   * If true, emit the optional `New Hypotheses` heading even when its body is
   * empty/null. Default: false (omit when empty).
   */
  includeNewHypothesesWhenEmpty?: boolean
}

export function serializeReadme(input: SerializeReadmeInput): string {
  const fmYaml = renderFrontMatter(input.frontMatter)
  const bodyParts: string[] = []
  for (const key of SECTION_ORDER) {
    if (key === 'newHypotheses' && !input.includeNewHypothesesWhenEmpty) {
      if (!input.sections.newHypotheses || input.sections.newHypotheses.trim() === '') continue
    }
    bodyParts.push(`## ${HEADING_FOR[key]}`)
    if (key === 'artifacts') {
      const artifactsBody = renderArtifacts(input.sections.artifacts)
      if (artifactsBody) bodyParts.push(artifactsBody)
    } else {
      const value = input.sections[key]
      if (value && value.trim() !== '') bodyParts.push(value.trim())
    }
    bodyParts.push('') // blank line between sections
  }
  return `---\n${fmYaml}---\n\n${bodyParts.join('\n').trimEnd()}\n`
}

/**
 * Convenience: round-trip through serializeReadme starting from a ParsedReadme.
 */
export function reserializeReadme(parsed: ParsedReadme): string {
  return serializeReadme({
    frontMatter: parsed.frontMatter,
    sections: parsed.sections,
  })
}

// ---------- helpers ----------

function renderFrontMatter(fm: ExperimentFrontMatter): string {
  const lines: string[] = []
  // Required scalars
  lines.push(`id: ${quoteIfNeeded(fm.id)}`)
  lines.push(`name: ${quoteIfNeeded(fm.name)}`)
  lines.push(`project: ${quoteIfNeeded(fm.project)}`)
  lines.push(`status: ${fm.status}`)
  lines.push(`created_at: ${quoteIfNeeded(fm.createdAt)}`)
  lines.push(`finished_at: ${fm.finishedAt === null ? 'null' : quoteIfNeeded(fm.finishedAt)}`)
  // Optional scalars (always emit, null when absent — explicit > implicit)
  lines.push(`host: ${fm.host === null ? 'null' : quoteIfNeeded(fm.host)}`)
  lines.push(`pid: ${fm.pid === null ? 'null' : fm.pid}`)
  lines.push(`gpus: ${renderNumberArray(fm.gpus)}`)
  lines.push(`entry: ${quoteIfNeeded(fm.entry)}`)
  lines.push(`command: ${quoteIfNeeded(fm.command)}`)
  lines.push(`wandb: ${fm.wandb === null ? 'null' : quoteIfNeeded(fm.wandb)}`)
  lines.push(`hypotheses: ${renderStringArray(fm.hypotheses)}`)
  lines.push(`tags: ${renderStringArray(fm.tags)}`)
  return `${lines.join('\n')}\n`
}

function quoteIfNeeded(value: string): string {
  // YAML strings that look like other types or contain : need quoting
  if (value === '') return "''"
  if (/[:#&*!|>'"%@`,\[\]\{\}]/.test(value)) return JSON.stringify(value)
  if (/^(true|false|null|~|yes|no|on|off)$/i.test(value)) return JSON.stringify(value)
  if (/^-?\d/.test(value)) return JSON.stringify(value)
  if (value.startsWith(' ') || value.endsWith(' ')) return JSON.stringify(value)
  return value
}

function renderNumberArray(arr: number[]): string {
  if (arr.length === 0) return '[]'
  return `[${arr.join(', ')}]`
}

function renderStringArray(arr: string[]): string {
  if (arr.length === 0) return '[]'
  return `[${arr.map(quoteIfNeeded).join(', ')}]`
}

function renderArtifacts(entries: ArtifactEntry[]): string {
  if (entries.length === 0) return ''
  return entries.map((e) => `- \`${e.path}\` — ${e.description}`).join('\n')
}
