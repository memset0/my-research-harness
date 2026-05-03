// parseHypotheses — turn a HYPOTHESES.md body into structured entries.
//
// Document layout (per spec):
//   ## Status legend            ← informational, kept as raw block
//   | ... |
//
//   ## Summary table            ← informational, kept as raw block
//   | ... |
//
//   ## H1. <slug>               ← entry (one per hypothesis)
//   - **Statement**: ...
//   - **Origin**: ...
//   - **Status**: ✅ CONFIRMED
//   - **Experiments**: foo-260501-100000 (data) → bar-260502-150000 (analysis)
//   - **Evidence**:
//     - bullet 1
//     - bullet 2
//   - **Caveats**:
//     - caveat 1
//   - **Last verified**: 2026-04-11
//
// Notes:
//   * The `Experiments` field tolerates any prose; we extract directory-name
//     patterns matching the experiment regex `<x>-\d{6}-\d{6}`.
//   * The `Status` field accepts emoji ("✅"), text ("CONFIRMED"), or both
//     ("✅ CONFIRMED").
//   * Unknown labeled bullets are kept in `extraFields` for debugging /
//     forward-compat (not surfaced via the typed Hypothesis, but warned about).

import type { Hypothesis, HypothesisStatus, ParseIssue, ParsedHypotheses } from '../types.js'
import { HYPOTHESIS_STATUS_EMOJI, HYPOTHESIS_STATUS_VALUES } from '../types.js'
import { splitH2Sections } from '../readme/sections.js'

const HYPOTHESIS_HEADING_REGEX = /^(H\d+)\.\s*(.*)$/
const LABEL_LINE_REGEX = /^-\s+\*\*([\w\s]+)\*\*\s*:\s*(.*)$/
const SUB_BULLET_REGEX = /^\s+-\s+(.*)$/
const EXPERIMENT_ID_REGEX = /[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*-\d{6}-\d{6}/g
const EMOJI_TO_STATUS: Record<string, HypothesisStatus> = Object.fromEntries(
  Object.entries(HYPOTHESIS_STATUS_EMOJI).map(([status, emoji]) => [emoji, status as HypothesisStatus]),
)
const VALID_STATUS_TEXT = new Set<string>(HYPOTHESIS_STATUS_VALUES)

export function parseHypotheses(content: string): ParsedHypotheses {
  const errors: ParseIssue[] = []
  const warnings: ParseIssue[] = []
  const entries: Hypothesis[] = []
  const seenIds = new Set<string>()

  const split = splitH2Sections(content)

  let legendBlock: string | null = null
  let summaryTableBlock: string | null = null

  for (const heading of split.order) {
    const body = split.sections.get(heading) ?? ''
    if (heading === 'Status legend') {
      legendBlock = body
      continue
    }
    if (heading === 'Summary table') {
      summaryTableBlock = body
      continue
    }
    const m = HYPOTHESIS_HEADING_REGEX.exec(heading)
    if (m) {
      const id = m[1]!
      const slug = m[2]!.trim()
      if (seenIds.has(id)) {
        warnings.push({
          field: id,
          message: `duplicate hypothesis ID "${id}"; only the first occurrence is indexed`,
          severity: 'warning',
        })
        continue
      }
      seenIds.add(id)
      const { hypothesis, issues } = parseEntry(id, slug, body)
      for (const issue of issues) {
        if (issue.severity === 'error') errors.push(issue)
        else warnings.push(issue)
      }
      entries.push(hypothesis)
      continue
    }
    warnings.push({
      field: heading,
      message: `unrecognized heading "${heading}" in HYPOTHESES.md (skipped)`,
      severity: 'warning',
    })
  }

  return {
    legendBlock,
    summaryTableBlock,
    entries,
    parseErrors: errors,
    parseWarnings: warnings,
  }
}

function parseEntry(
  id: string,
  slug: string,
  body: string,
): { hypothesis: Hypothesis; issues: ParseIssue[] } {
  const issues: ParseIssue[] = []
  const fields = extractLabeledFields(body)

  const statementLines = fields.get('Statement') ?? []
  const originLines = fields.get('Origin') ?? []
  const statusLines = fields.get('Status') ?? []
  const experimentsLines = fields.get('Experiments') ?? []
  const evidenceLines = fields.get('Evidence') ?? []
  const caveatsLines = fields.get('Caveats') ?? []
  const lastVerifiedLines = fields.get('Last verified') ?? []

  const status = parseStatusValue(statusLines.join(' ').trim())
  if (status === null) {
    issues.push({
      field: `${id}.Status`,
      message: `unable to parse status for ${id} (got "${statusLines.join(' ').trim()}")`,
      severity: 'error',
    })
  }

  const experimentsRaw = experimentsLines.join(' ')
  const experiments = Array.from(experimentsRaw.matchAll(EXPERIMENT_ID_REGEX), (m) => m[0])

  const lastVerifiedRaw = lastVerifiedLines.join(' ').trim()
  const lastVerified = lastVerifiedRaw === '' || lastVerifiedRaw === '—' ? null : lastVerifiedRaw

  return {
    hypothesis: {
      id,
      slug,
      statement: statementLines.join(' ').trim(),
      origin: originLines.join(' ').trim(),
      status: status ?? 'OPEN',
      experiments,
      evidence: evidenceLines,
      caveats: caveatsLines,
      lastVerified,
    },
    issues,
  }
}

/**
 * Walk a hypothesis entry body and collect labeled field values.
 *
 * For inline labels (`- **Foo**: text`), the value is a 1-element array `[text]`.
 * For multi-line labels (`- **Foo**:` followed by sub-bullets), the value is
 * one element per sub-bullet. Sub-bullets are recognized by ANY indentation +
 * `- ` (at least 2 spaces).
 */
function extractLabeledFields(body: string): Map<string, string[]> {
  const fields = new Map<string, string[]>()
  let currentLabel: string | null = null
  let inlineSet = false

  for (const rawLine of body.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    const labelMatch = LABEL_LINE_REGEX.exec(line)
    if (labelMatch) {
      currentLabel = labelMatch[1]!.trim()
      const inline = labelMatch[2]!.trim()
      if (inline) {
        fields.set(currentLabel, [inline])
        inlineSet = true
      } else {
        fields.set(currentLabel, [])
        inlineSet = false
      }
      continue
    }
    const subMatch = SUB_BULLET_REGEX.exec(line)
    if (subMatch && currentLabel !== null && !inlineSet) {
      fields.get(currentLabel)!.push(subMatch[1]!.trim())
      continue
    }
    // ignore non-matching lines (blank lines, prose, etc.)
  }

  return fields
}

function parseStatusValue(text: string): HypothesisStatus | null {
  if (!text) return null
  // Try emoji first
  for (const [emoji, status] of Object.entries(EMOJI_TO_STATUS)) {
    if (text.includes(emoji)) return status
  }
  // Try uppercase text token
  const upper = text.toUpperCase()
  for (const candidate of HYPOTHESIS_STATUS_VALUES) {
    if (upper.includes(candidate)) return candidate
  }
  if (VALID_STATUS_TEXT.has(text.trim())) return text.trim() as HypothesisStatus
  return null
}
