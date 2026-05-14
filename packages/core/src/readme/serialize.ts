// serializeReadme — turn a ParsedReadme back into raw markdown.
//
// v5 section ordering: Motivation / Setup / Method / Result / Conclusion /
// Artifacts. Caveats is REMOVED from the run-side serializer order (it
// lives on the parent exp doc only). Empty/null required sections produce
// a heading with an empty body rather than being omitted, so that:
//   - editors round-trip cleanly
//   - the user can fill in a placeholder section without renaming/reordering
//
// Optional run-side sections (Motivation, Method, Conclusion) are also
// emitted as headings with empty bodies when null (consistent with the
// other empty sections); the web UI hides the empty placeholders.
//
// The Artifacts section is regenerated from the structured entries, so any
// extra prose in that section is dropped — agents writing free-form Artifacts
// text should put it in another section.

import type {
  ArtifactEntry,
  RunFrontMatter,
  RunSections,
  ParsedReadme,
} from '../types.js'
import { isId } from '../ids.js'

// v5 run-side canonical section order: 4 sections plus the legacy-optional
// New Hypotheses. Method / Conclusion / Caveats are NOT emitted (they're
// forbidden on the run side per the parse policy).
const SECTION_ORDER: ReadonlyArray<
  keyof Pick<RunSections, 'motivation' | 'setup' | 'result' | 'newHypotheses'> | 'artifacts'
> = [
  'motivation',
  'setup',
  'result',
  'artifacts',
  'newHypotheses',
]

const HEADING_FOR: Record<(typeof SECTION_ORDER)[number], string> = {
  motivation: 'Motivation',
  setup: 'Setup',
  result: 'Result',
  artifacts: 'Artifacts',
  newHypotheses: 'New Hypotheses',
}

export interface SerializeReadmeInput {
  frontMatter: RunFrontMatter
  sections: RunSections
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

function renderFrontMatter(fm: RunFrontMatter): string {
  const lines: string[] = []
  // Required scalars
  lines.push(`id: ${quoteIfNeeded(fm.id)}`)
  lines.push(`name: ${quoteIfNeeded(fm.name)}`)
  lines.push(`status: ${fm.status}`)
  // v3 task 4.2: parent experiment doc id (null when unbound). Always emit.
  lines.push(`experiment: ${fm.experiment === null ? 'null' : quoteIfNeeded(fm.experiment)}`)
  lines.push(`created_at: ${quoteIfNeeded(fm.createdAt)}`)
  // v3 task 4.2: updated_at is bumped by writers; always emit (defaults to
  // createdAt when never edited). Old readers tolerate the new field.
  lines.push(`updated_at: ${quoteIfNeeded(fm.updatedAt)}`)
  lines.push(`finished_at: ${fm.finishedAt === null ? 'null' : quoteIfNeeded(fm.finishedAt)}`)
  // Optional scalars (always emit, null when absent — explicit > implicit)
  lines.push(`host: ${fm.host === null ? 'null' : quoteIfNeeded(fm.host)}`)
  lines.push(`pid: ${fm.pid === null ? 'null' : fm.pid}`)
  lines.push(`gpus: ${renderNumberArray(fm.gpus)}`)
  // v4-added: archived flag in canonical key order (between gpus and entry).
  lines.push(`archived: ${fm.archived ? 'true' : 'false'}`)
  lines.push(`entry: ${quoteIfNeeded(fm.entry)}`)
  lines.push(`command: ${quoteIfNeeded(fm.command)}`)
  lines.push(`wandb: ${fm.wandb === null ? 'null' : quoteIfNeeded(fm.wandb)}`)
  // v3 task 4.2: legacy v2 fields (`project`, `hypotheses`, `tags`) are
  // dropped from new writes. We still parse them on read for back-compat,
  // but a fresh serialize emits the canonical v3 shape only. The
  // motivation is that these now belong on the parent experiment doc;
  // duplicating them per run drifts (see openspec spec rationale §F1).
  // Validate any caller-supplied hypothesis refs would be canonical, so
  // existing tooling that still passes them in detects malformed values
  // even though we no longer emit the line.
  for (const ref of fm.hypotheses) {
    if (!isId(ref, 'H')) {
      throw new Error(
        `serializeReadme: hypotheses[] element "${ref}" is not canonical (expected H<NNNN>, e.g. H0003)`,
      )
    }
  }
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
