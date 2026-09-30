// parseHypotheses — turn a docs/hypotheses.md body into structured entries.
//
// Document layout (per spec):
//   ## Status legend            ← informational, kept as raw block
//   | ... |
//
//   ## Summary table            ← informational, kept as raw block
//   | ... |
//
//   ## H0001. <slug>            ← entry (one per hypothesis)
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

import { parseId } from '../ids.js'
import { splitH2Sections } from '../readme/sections.js'
import type { Hypothesis, HypothesisStatus, ParsedHypotheses, ParseIssue } from '../types.js'
import { HYPOTHESIS_STATUS_EMOJI, HYPOTHESIS_STATUS_VALUES } from '../types.js'

// Canonical hypothesis heading: `H<NNNN>. <slug>` where NNNN is exactly
// 4 digits. Any other H-prefixed heading is treated as malformed.
const HYPOTHESIS_HEADING_REGEX = /^(H\d{4})\.\s*(.*)$/
// Catches anything else that started with `H<digits>.` so we can warn
// specifically about wrong-format ids.
const HYPOTHESIS_HEADING_LOOSE_REGEX = /^H\d+\.\s*/
const LABEL_LINE_REGEX = /^-\s+\*\*([\w\s]+)\*\*\s*:\s*(.*)$/
const SUB_BULLET_REGEX = /^\s+-\s+(.*)$/
// Run dir basename pattern: `<slug>-yymmdd-hhmmss`.
const RUN_ID_REGEX = /[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*-\d{6}-\d{6}/g
// v3 experiment doc id: `E<NNNN>-<slug>` where slug starts with a-z0-9.
const EXPERIMENT_DOC_ID_REGEX = /E\d{4}-[a-z0-9][a-z0-9-]*[a-z0-9]/g
// Canonical exact-match check for a single token (used by helper below).
const EXPERIMENT_DOC_ID_EXACT = /^E\d{4}-[a-z0-9][a-z0-9-]*[a-z0-9]$/
const RUN_ID_EXACT = /^[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*-\d{6}-\d{6}$/

/**
 * v3 task 3.5: split a free-form references field into v3 experiment doc
 * ids vs legacy run dir names.
 *
 * Tokens are pulled out of the prose by the two id regexes (so it's safe
 * to feed `Experiments: foo-260501-100000 (data) → bar-260502-150000 (analysis)`
 * verbatim — surrounding prose is ignored). Each extracted token is then
 * classified by exact-match shape:
 *   - `E\d{4}-…`             → experiments[]
 *   - `<slug>-yymmdd-hhmmss` → runs[]
 *   - anything else          → dropped (won't happen given the regexes)
 *
 * Caller decides how to react to `runs[]` being non-empty under an
 * `Experiments:` field (e.g. emit `MIGRATE_HYPOTHESIS_REFS` to nudge the
 * user toward the new `Runs:` field).
 */
export function parseExperimentRefList(text: string): {
  experiments: string[]
  runs: string[]
} {
  const seen = new Set<string>()
  const experiments: string[] = []
  const runs: string[] = []
  // Pull exp doc ids first so a later run-id match for the same prefix
  // (impossible given the digit anchor, but defensive) wouldn't double-add.
  for (const m of text.matchAll(EXPERIMENT_DOC_ID_REGEX)) {
    if (seen.has(m[0])) continue
    seen.add(m[0])
    if (EXPERIMENT_DOC_ID_EXACT.test(m[0])) experiments.push(m[0])
  }
  for (const m of text.matchAll(RUN_ID_REGEX)) {
    if (seen.has(m[0])) continue
    seen.add(m[0])
    if (RUN_ID_EXACT.test(m[0])) runs.push(m[0])
  }
  return { experiments, runs }
}
const EMOJI_TO_STATUS: Record<string, HypothesisStatus> = Object.fromEntries(
  Object.entries(HYPOTHESIS_STATUS_EMOJI).map(([status, emoji]) => [
    emoji,
    status as HypothesisStatus,
  ]),
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
      // Tighten via parseId — also rules out H0000 (value-zero).
      if (!parseId(id)) {
        warnings.push({
          field: heading,
          message: `INVALID_HYPOTHESIS_ID: "${id}" must be canonical 4-digit form in [H0001, H9999]`,
          severity: 'warning',
        })
        continue
      }
      const slug = m[2]!.trim()
      if (seenIds.has(id)) {
        warnings.push({
          field: id,
          message: `DUPLICATE_HYPOTHESIS_ID: "${id}"; only the first occurrence is indexed`,
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
    if (HYPOTHESIS_HEADING_LOOSE_REGEX.test(heading)) {
      // Looks like a hypothesis heading but doesn't match the canonical
      // 4-digit form — name it explicitly so users can fix.
      warnings.push({
        field: heading,
        message: `INVALID_HYPOTHESIS_ID: heading "${heading}" must use 4-digit zero-padded form (e.g. "H0001. ${heading.replace(/^H\d+\.\s*/, '')}")`,
        severity: 'warning',
      })
      continue
    }
    warnings.push({
      field: heading,
      message: `unrecognized heading "${heading}" in docs/hypotheses.md (skipped)`,
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
  const runsLines = fields.get('Runs') ?? []
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

  // v3 task 3.5+3.6: the `Experiments:` field can carry a mix of v3 exp
  // doc ids (E0001-foo) and legacy run dir names (foo-260501-100000).
  // Split via the ref-list helper; surface MIGRATE_HYPOTHESIS_REFS so the
  // user knows to move run-dir names to the new `Runs:` field. The new
  // `Runs:` field is parsed in addition to (and merged with) the migration
  // results.
  const { experiments: expsFromExperimentsField, runs: runsFromExperimentsField } =
    parseExperimentRefList(experimentsLines.join(' '))
  if (runsFromExperimentsField.length > 0) {
    issues.push({
      field: `${id}.Experiments`,
      message: `MIGRATE_HYPOTHESIS_REFS: ${runsFromExperimentsField.length} run-dir reference(s) found under Experiments — move them to a Runs: field. Run ids: ${runsFromExperimentsField.join(', ')}`,
      severity: 'warning',
    })
  }
  const { experiments: expsFromRunsField, runs: runsFromRunsField } = parseExperimentRefList(
    runsLines.join(' '),
  )
  if (expsFromRunsField.length > 0) {
    issues.push({
      field: `${id}.Runs`,
      message: `MIGRATE_HYPOTHESIS_REFS: ${expsFromRunsField.length} experiment id(s) found under Runs — move them to the Experiments: field. Exp ids: ${expsFromRunsField.join(', ')}`,
      severity: 'warning',
    })
  }
  // Merge + de-duplicate while preserving discovery order.
  const experiments = mergeUnique(expsFromExperimentsField, expsFromRunsField)
  const runs = mergeUnique(runsFromExperimentsField, runsFromRunsField)

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
      runs,
      evidence: evidenceLines,
      caveats: caveatsLines,
      lastVerified,
    },
    issues,
  }
}

function mergeUnique(a: string[], b: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of [...a, ...b]) {
    if (!seen.has(x)) {
      seen.add(x)
      out.push(x)
    }
  }
  return out
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
