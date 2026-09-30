// Run README serializers.
//
// New records use serializeMinimalRun. The section-based serializeReadme
// remains for callers deliberately building legacy documents.
// Metadata-only reserialization patches the source YAML and preserves the
// complete body, comments, unknown fields and unmodified legacy values.

import { isId } from '../ids.js'
import type { ArtifactEntry, ParsedReadme, RunFrontMatter, RunSections } from '../types.js'
import {
  type PatchableRunFrontMatterKey,
  patchRunFrontMatter,
  type RunFrontMatterPatch,
} from './frontmatter-patch.js'
import { parseReadme } from './parse.js'

// Legacy run-side section order. `Motivation` / `Setup` / `Result` /
// `Artifacts` are always emitted (empty heading + empty body round-trips
// cleanly). `Method` / `Conclusion` / `Caveats` / `New Hypotheses` are
// emitted only when populated: v6 does not ask a Run for those chapters,
// but a legacy document that has them keeps them — dropping content on an
// unrelated status/archive edit would be data loss.
const SECTION_ORDER: ReadonlyArray<
  | keyof Pick<
      RunSections,
      'motivation' | 'setup' | 'method' | 'result' | 'conclusion' | 'caveats' | 'newHypotheses'
    >
  | 'artifacts'
> = [
  'motivation',
  'setup',
  'method',
  'result',
  'conclusion',
  'caveats',
  'artifacts',
  'newHypotheses',
]

/** Sections omitted entirely when their body is empty or absent. */
const WHEN_POPULATED: ReadonlyArray<(typeof SECTION_ORDER)[number]> = [
  'method',
  'conclusion',
  'caveats',
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
    if (key !== 'artifacts' && WHEN_POPULATED.includes(key)) {
      const value = input.sections[key]
      const forced = key === 'newHypotheses' && input.includeNewHypothesesWhenEmpty === true
      if (!forced && (value === null || value.trim() === '')) continue
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
 * v6 minimal Run record: the canonical frontmatter keys a newly created Run
 * may carry, in emission order. Execution identity, state, timestamps,
 * association, plus this run's own execution facts — nothing inherited from
 * the parent Experiment (`project` / `hypotheses` / `tags` are legacy-read
 * only) and no narrative chapters.
 *
 * `id`, `status`, and `created_at` are always emitted. `experiment`,
 * `updated_at`, `finished_at`, `host`, `pid`, `gpus`, `entry`, `command`,
 * `wandb`, `name` are emitted only when they carry a value; `archived` and
 * `deprecated` only when true (absent means false).
 */
export const MINIMAL_RUN_FRONT_MATTER_KEYS = [
  'id',
  'name',
  'status',
  'experiment',
  'created_at',
  'updated_at',
  'finished_at',
  'host',
  'pid',
  'gpus',
  'entry',
  'command',
  'wandb',
  'archived',
  'deprecated',
] as const

export interface SerializeMinimalRunInput {
  frontMatter: RunFrontMatter
  /**
   * Free-form body, written verbatim (minus surrounding blank lines). A
   * minimal Run has no mandatory sections: notes that belong to the whole
   * Experiment live on the Experiment document, not repeated per run.
   */
  body?: string
}

/**
 * Serialize a v6 minimal Run README: minimal frontmatter plus a free-form
 * body. Use this for every new Run write path; `serializeReadme` remains for
 * legacy rich documents that still carry the v5 section set.
 */
export function serializeMinimalRun(input: SerializeMinimalRunInput): string {
  const fmYaml = renderMinimalFrontMatter(input.frontMatter)
  return `---\n${fmYaml}---\n${input.body ?? ''}`
}

/** Patch changed metadata without reconstructing any untouched source content. */
export function reserializeReadme(parsed: ParsedReadme): string {
  if (parsed.frontMatterSource) {
    const original = parseReadme(parsed.frontMatterSource)
    const before = declaredFrontMatterValues(original)
    const after = declaredFrontMatterValues(parsed)
    const patch: RunFrontMatterPatch = {}
    for (const [key, value] of after) {
      if (before.get(key) !== value) patch[key] = value
    }
    for (const key of before.keys()) {
      if (!after.has(key)) patch[key] = null
    }
    return patchRunFrontMatter(parsed.frontMatterSource + parsed.body, patch)
  }
  const fmYaml = renderDeclaredFrontMatter(parsed.frontMatter, parsed.frontMatterKeys)
  return `---\n${fmYaml}---\n${parsed.body}`
}

function declaredFrontMatterValues(parsed: ParsedReadme): Map<PatchableRunFrontMatterKey, string> {
  const rendered = renderDeclaredFrontMatter(parsed.frontMatter, parsed.frontMatterKeys)
  return new Map(
    rendered
      .trimEnd()
      .split('\n')
      .map((line) => {
        const colon = line.indexOf(':')
        return [line.slice(0, colon) as PatchableRunFrontMatterKey, line.slice(colon + 2)]
      }),
  )
}

// ---------- helpers ----------

function renderFrontMatter(fm: RunFrontMatter): string {
  const lines: string[] = []
  // Required scalars
  lines.push(`id: ${quoteIfNeeded(fm.id)}`)
  lines.push(`name: ${quoteIfNeeded(fm.name)}`)
  lines.push(`status: ${fm.status}`)
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
  // v6-added: research-eligibility flag. Written only when true — absence
  // is the canonical `false`, so unaffected runs keep their exact shape.
  if (fm.deprecated) lines.push('deprecated: true')
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

/**
 * Frontmatter for a mutated document: emit a key when it carries
 * information OR when the source declared it. `id`, `status`, and
 * `created_at` are always written (they identify the run and its clock).
 *
 * This keeps a v5 document's explicit `wandb: null` / `archived: false`
 * block intact while leaving a v6 minimal record minimal — the mutation
 * changes the value it was asked to change and nothing else. Legacy
 * inherited keys (`project` / `hypotheses` / `tags`) are preserved when the
 * file already had them; `serializeReadme` is still the writer that drops
 * them from freshly built documents.
 */
function renderDeclaredFrontMatter(fm: RunFrontMatter, declared: readonly string[]): string {
  const has = (key: string): boolean => declared.includes(key)
  const lines: string[] = []
  lines.push(`id: ${quoteIfNeeded(fm.id)}`)
  if (fm.name !== '' || has('name')) lines.push(`name: ${quoteIfNeeded(fm.name)}`)
  if (has('project')) lines.push(`project: ${quoteIfNeeded(fm.project)}`)
  lines.push(`status: ${fm.status}`)
  lines.push(`created_at: ${quoteIfNeeded(fm.createdAt)}`)
  if ((fm.updatedAt !== '' && fm.updatedAt !== fm.createdAt) || has('updated_at')) {
    lines.push(`updated_at: ${quoteIfNeeded(fm.updatedAt)}`)
  }
  if (fm.finishedAt !== null || has('finished_at')) {
    lines.push(`finished_at: ${fm.finishedAt === null ? 'null' : quoteIfNeeded(fm.finishedAt)}`)
  }
  if (fm.host !== null || has('host')) {
    lines.push(`host: ${fm.host === null ? 'null' : quoteIfNeeded(fm.host)}`)
  }
  if (fm.pid !== null || has('pid')) lines.push(`pid: ${fm.pid === null ? 'null' : fm.pid}`)
  if (fm.gpus.length > 0 || has('gpus')) lines.push(`gpus: ${renderNumberArray(fm.gpus)}`)
  if (fm.archived || has('archived')) lines.push(`archived: ${fm.archived ? 'true' : 'false'}`)
  if (fm.entry !== '' || has('entry')) lines.push(`entry: ${quoteIfNeeded(fm.entry)}`)
  if (fm.command !== '' || has('command')) lines.push(`command: ${quoteIfNeeded(fm.command)}`)
  if (fm.wandb !== null || has('wandb')) {
    lines.push(`wandb: ${fm.wandb === null ? 'null' : quoteIfNeeded(fm.wandb)}`)
  }
  if (fm.deprecated || has('deprecated')) {
    lines.push(`deprecated: ${fm.deprecated ? 'true' : 'false'}`)
  }
  if (has('hypotheses')) lines.push(`hypotheses: ${renderStringArray(fm.hypotheses)}`)
  if (has('tags')) lines.push(`tags: ${renderStringArray(fm.tags)}`)
  return `${lines.join('\n')}\n`
}

/**
 * v6 minimal frontmatter: only keys that carry information. Defaults
 * (`null`, `[]`, `false`) are omitted rather than written out, and no
 * Experiment-inherited key is ever emitted.
 */
function renderMinimalFrontMatter(fm: RunFrontMatter): string {
  const lines: string[] = []
  lines.push(`id: ${quoteIfNeeded(fm.id)}`)
  if (fm.name !== '') lines.push(`name: ${quoteIfNeeded(fm.name)}`)
  lines.push(`status: ${fm.status}`)
  lines.push(`created_at: ${quoteIfNeeded(fm.createdAt)}`)
  if (fm.updatedAt !== '' && fm.updatedAt !== fm.createdAt) {
    lines.push(`updated_at: ${quoteIfNeeded(fm.updatedAt)}`)
  }
  if (fm.finishedAt !== null) lines.push(`finished_at: ${quoteIfNeeded(fm.finishedAt)}`)
  if (fm.host !== null) lines.push(`host: ${quoteIfNeeded(fm.host)}`)
  if (fm.pid !== null) lines.push(`pid: ${fm.pid}`)
  if (fm.gpus.length > 0) lines.push(`gpus: ${renderNumberArray(fm.gpus)}`)
  if (fm.entry !== '') lines.push(`entry: ${quoteIfNeeded(fm.entry)}`)
  if (fm.command !== '') lines.push(`command: ${quoteIfNeeded(fm.command)}`)
  if (fm.wandb !== null) lines.push(`wandb: ${quoteIfNeeded(fm.wandb)}`)
  if (fm.archived) lines.push('archived: true')
  if (fm.deprecated) lines.push('deprecated: true')
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
