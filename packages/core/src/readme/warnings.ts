// Warnings — structured, human-clearable flags on an experiment's README.md.
//
// On disk, warnings live in an OPTIONAL `## Warnings` H2 section between
// `## Caveats` and `## Artifacts`. The section body is exactly one GFM table
// with a fixed column header. Each row carries a stable `rowId` embedded in
// a trailing HTML comment.
//
// Agents may APPEND `[OPEN]` rows; `RESOLVED` / delete are human-only acts
// (the CLI exposes them, but skills SHALL NOT call them — see memon-skills).
//
// All writers are SECTION-BOUND: lines outside `## Warnings` are guaranteed
// byte-identical pre/post via a diff assertion, so a warning append never
// races with a user editing `## Method` etc. (the conflict path catches that
// via mtime+hash on the whole file).

import { randomBytes } from 'node:crypto'
import type { ParseIssue } from '../types.js'

// ---------- Types ----------

export type WarningStatus = 'OPEN' | 'RESOLVED'

export const WARNING_STATUS_VALUES: readonly WarningStatus[] = ['OPEN', 'RESOLVED'] as const

export type WarningCategory =
  | 'methodology'
  | 'result'
  | 'config'
  | 'data'
  | 'repro'
  | 'compare'
  | 'infra'
  | 'other'

export const WARNING_CATEGORIES: readonly WarningCategory[] = [
  'methodology',
  'result',
  'config',
  'data',
  'repro',
  'compare',
  'infra',
  'other',
] as const

export interface Warning {
  rowId: string
  status: WarningStatus
  /** ISO8601 with timezone offset, set at append time, never edited. */
  created: string
  /** Out-of-enum values are preserved as-is (parser surfaces a warning). */
  category: WarningCategory | string
  message: string
  /** ISO8601 with offset when status === RESOLVED; null otherwise. */
  resolved: string | null
  note: string | null
}

export interface ParsedWarnings {
  warnings: Warning[]
  /** Raw section bytes when the section body is non-conforming; null otherwise. */
  raw: string | null
  parseWarnings: ParseIssue[]
}

// ---------- Heading detection ----------

const WARNINGS_HEADING_RE = /^##\s+Warnings\s*$/

export interface SectionRange {
  /** Index of the `## Warnings` heading line in the line array. */
  headingLine: number
  /** First line of body (heading + 1). */
  bodyStart: number
  /**
   * Index one past the last line of the section body. End equals the line
   * index of the next H2 heading at column 0, OR the total line count when
   * the section is the last one in the file.
   */
  bodyEnd: number
}

/**
 * Locate the `## Warnings` section by an anchored heading match. Returns
 * `null` when the section is absent. Code fences are respected so a literal
 * `## Warnings` inside a fenced block does not match.
 */
export function findWarningsSectionRange(lines: string[]): SectionRange | null {
  let inFence = false
  let headingLine = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (/^```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    if (WARNINGS_HEADING_RE.test(line)) {
      headingLine = i
      break
    }
  }
  if (headingLine === -1) return null

  // Find the next H2 (or any heading at the same level) to bound the body.
  let bodyEnd = lines.length
  inFence = false
  for (let i = headingLine + 1; i < lines.length; i++) {
    const line = lines[i]!
    if (/^```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    if (/^##\s+/.test(line)) {
      bodyEnd = i
      break
    }
  }
  return { headingLine, bodyStart: headingLine + 1, bodyEnd }
}

// ---------- Parsing ----------

/** Parse the body string of the `## Warnings` section. */
export function parseWarningsBody(body: string): ParsedWarnings {
  const issues: ParseIssue[] = []
  const lines = body.split('\n')

  // Locate the table: the first line that starts with `|` and contains
  // `Status` (case-insensitive) is the header; the next line is the
  // separator; remaining `|`-prefixed lines are rows.
  let headerIdx = -1
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!.trim()
    if (l.startsWith('|') && /\bStatus\b/i.test(l)) {
      headerIdx = i
      break
    }
  }
  if (headerIdx === -1) {
    // No table at all. If the body is purely whitespace, treat as empty.
    if (body.trim() === '') return { warnings: [], raw: null, parseWarnings: issues }
    issues.push({
      field: 'warnings',
      message: 'WARNINGS_SECTION_NOT_TABLE: section body is not a recognised warnings table',
      severity: 'warning',
    })
    return { warnings: [], raw: body, parseWarnings: issues }
  }

  const header = parseTableRow(lines[headerIdx]!).map((s) => s.trim().toLowerCase())
  const expected = ['status', 'created', 'category', 'message', 'resolved', 'note']
  if (header.length !== expected.length || !expected.every((c, i) => header[i] === c)) {
    issues.push({
      field: 'warnings',
      message: `WARNINGS_SECTION_NOT_TABLE: header row must be exactly | Status | Created | Category | Message | Resolved | Note | (got ${JSON.stringify(header)})`,
      severity: 'warning',
    })
    return { warnings: [], raw: body, parseWarnings: issues }
  }

  const warnings: Warning[] = []
  for (let i = headerIdx + 2; i < lines.length; i++) {
    const raw = lines[i]!
    const trimmed = raw.trim()
    if (trimmed === '') continue
    if (!trimmed.startsWith('|')) {
      // Stray non-row content inside the warnings section — treat as
      // non-conforming and bail out, surfacing the entire body raw.
      issues.push({
        field: 'warnings',
        message: 'WARNINGS_SECTION_NOT_TABLE: non-row content inside the warnings table',
        severity: 'warning',
      })
      return { warnings: [], raw: body, parseWarnings: issues }
    }
    const parsed = parseWarningRow(raw, issues)
    if (parsed) warnings.push(parsed)
  }
  return { warnings, raw: null, parseWarnings: issues }
}

const ROWID_COMMENT_RE = /<!--\s*id:(w_[^\s>]+)\s*-->\s*$/

function parseWarningRow(line: string, issues: ParseIssue[]): Warning | null {
  // Extract trailing rowId comment first; without it we can't address the row.
  let body = line
  let rowId: string | null = null
  const m = ROWID_COMMENT_RE.exec(body)
  if (m) {
    rowId = m[1]!
    body = body.slice(0, m.index).trimEnd()
  }

  const cells = parseTableRow(body)
  if (cells.length < 6) {
    issues.push({
      field: 'warnings',
      message: `WARNINGS_SECTION_NOT_TABLE: row has ${cells.length} cells, expected 6`,
      severity: 'warning',
    })
    return null
  }
  const [statusRaw, createdRaw, categoryRaw, messageRaw, resolvedRaw, noteRaw] = cells.map(
    (c) => c.trim(),
  ) as [string, string, string, string, string, string]

  // Status normalisation.
  let status: WarningStatus
  const upper = statusRaw.toUpperCase()
  if (upper === 'OPEN') {
    status = 'OPEN'
    if (statusRaw !== 'OPEN') {
      issues.push({
        field: 'warnings.status',
        message: `WARNING_STATUS_LOWERCASE: status "${statusRaw}" normalised to OPEN`,
        severity: 'warning',
      })
    }
  } else if (upper === 'RESOLVED') {
    status = 'RESOLVED'
    if (statusRaw !== 'RESOLVED') {
      issues.push({
        field: 'warnings.status',
        message: `WARNING_STATUS_LOWERCASE: status "${statusRaw}" normalised to RESOLVED`,
        severity: 'warning',
      })
    }
  } else {
    issues.push({
      field: 'warnings.status',
      message: `WARNING_STATUS_LOWERCASE: status "${statusRaw}" must be OPEN or RESOLVED; defaulting to OPEN`,
      severity: 'warning',
    })
    status = 'OPEN'
  }

  // Category — preserve out-of-enum values, but flag.
  const category = categoryRaw
  if (!(WARNING_CATEGORIES as readonly string[]).includes(category)) {
    issues.push({
      field: 'warnings.category',
      message: `UNKNOWN_WARNING_CATEGORY: "${category}" is not in the closed enum`,
      severity: 'warning',
    })
  }

  const created = createdRaw
  const message = unescapeCell(messageRaw)
  const resolved = resolvedRaw === '' || resolvedRaw === '—' ? null : resolvedRaw
  const note = noteRaw === '' || noteRaw === '—' ? null : unescapeCell(noteRaw)

  if (rowId === null) {
    // No rowId comment — synthesise one from created so the caller can still
    // address the row, but flag it.
    rowId = synthesiseRowIdForLegacy(created)
    issues.push({
      field: 'warnings.rowId',
      message: 'WARNINGS_SECTION_NOT_TABLE: row missing trailing <!-- id:w_... --> comment; synthesised',
      severity: 'warning',
    })
  }

  return { rowId, status, created, category, message, resolved, note }
}

function parseTableRow(line: string): string[] {
  // Split on `|` while honouring `\|` escapes. Strip the leading and
  // trailing pipes (a normal GFM row starts and ends with `|`).
  const out: string[] = []
  let buf = ''
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (ch === '\\' && line[i + 1] === '|') {
      buf += '|'
      i++
      continue
    }
    if (ch === '|') {
      out.push(buf)
      buf = ''
      continue
    }
    buf += ch
  }
  if (buf.length > 0) out.push(buf)
  // GFM rows have a leading and trailing empty cell from the bordering `|`.
  if (out.length > 0 && out[0]!.trim() === '') out.shift()
  if (out.length > 0 && out[out.length - 1]!.trim() === '') out.pop()
  return out
}

function unescapeCell(cell: string): string {
  return cell.replace(/<br\s*\/?>/gi, '\n')
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, '<br>')
}

function synthesiseRowIdForLegacy(created: string): string {
  return `w_${created.replace(/:/g, '-')}_${randomHex(4)}`
}

// ---------- Serialisation ----------

const TABLE_HEADER = '| Status | Created | Category | Message | Resolved | Note |'
const TABLE_SEPARATOR = '|--------|---------|----------|---------|----------|------|'

/** Serialise one warning to a single table row line (no trailing newline). */
export function serializeWarningRow(w: Warning): string {
  const status = w.status
  const created = w.created
  const category = w.category
  const message = escapeCell(w.message)
  const resolved = w.resolved ?? '—'
  const note = w.note === null || w.note === '' ? '—' : escapeCell(w.note)
  return `| ${status} | ${created} | ${category} | ${message} | ${resolved} | ${note} | <!-- id:${w.rowId} -->`
}

/** Render the body lines of a `## Warnings` section from a list of warnings. */
export function renderWarningsBody(warnings: Warning[]): string[] {
  if (warnings.length === 0) {
    return [TABLE_HEADER, TABLE_SEPARATOR]
  }
  return [TABLE_HEADER, TABLE_SEPARATOR, ...warnings.map(serializeWarningRow)]
}

// ---------- Section-bound writer ----------

export type WarningOp =
  | { op: 'add'; category: WarningCategory | string; message: string; created: string; rowId: string }
  | { op: 'resolve'; rowId: string; resolved: string; note: string }
  | { op: 'reopen'; rowId: string }
  | { op: 'delete'; rowId: string }

export interface ApplyWarningOpResult {
  /** Updated full README content. */
  content: string
  /** For `add`, the new rowId; for `delete`, the deleted row. */
  rowId?: string
  deleted?: Warning
  before?: Warning
  after?: Warning
}

export class WarningOpError extends Error {
  constructor(
    public code: 'NOT_FOUND' | 'BAD_REQUEST' | 'NOT_TABLE' | 'INTERNAL',
    message: string,
  ) {
    super(message)
    this.name = 'WarningOpError'
  }
}

/**
 * Apply a single warning operation to the README content. Section-bound:
 * lines outside `## Warnings` are byte-identical pre/post (asserted before
 * returning; assertion failure throws WarningOpError('INTERNAL')).
 */
export function applyWarningOp(content: string, op: WarningOp): ApplyWarningOpResult {
  const originalLines = content.split('\n')
  let lines = [...originalLines]
  let range = findWarningsSectionRange(lines)

  if (op.op === 'add') {
    if (!range) {
      const insert = insertWarningsSectionLines(lines)
      lines = insert.lines
      range = insert.range
    }
    const { warnings, raw, parseWarnings } = parseWarningsBody(
      lines.slice(range.bodyStart, range.bodyEnd).join('\n'),
    )
    if (raw !== null) {
      throw new WarningOpError(
        'NOT_TABLE',
        `cannot append: ## Warnings section is non-conforming (${parseWarnings.map((p) => p.message).join('; ')})`,
      )
    }
    const created = op.created
    const rowId = op.rowId
    if (warnings.some((w) => w.rowId === rowId)) {
      throw new WarningOpError('INTERNAL', `rowId collision: ${rowId}`)
    }
    const newWarning: Warning = {
      rowId,
      status: 'OPEN',
      created,
      category: op.category,
      message: op.message,
      resolved: null,
      note: null,
    }
    const newWarnings = [...warnings, newWarning]
    lines = replaceSectionBody(lines, range, renderWarningsBody(newWarnings))
    const newContent = lines.join('\n')
    assertSectionBound(originalLines, lines, range)
    return { content: newContent, rowId, after: newWarning }
  }

  if (!range) {
    throw new WarningOpError('NOT_FOUND', 'no ## Warnings section')
  }
  const { warnings, raw, parseWarnings } = parseWarningsBody(
    lines.slice(range.bodyStart, range.bodyEnd).join('\n'),
  )
  if (raw !== null) {
    throw new WarningOpError(
      'NOT_TABLE',
      `cannot mutate: ## Warnings section is non-conforming (${parseWarnings.map((p) => p.message).join('; ')})`,
    )
  }
  const idx = warnings.findIndex((w) => w.rowId === op.rowId)
  if (idx === -1) throw new WarningOpError('NOT_FOUND', `rowId not found: ${op.rowId}`)
  const before = { ...warnings[idx]! }

  if (op.op === 'resolve') {
    warnings[idx] = {
      ...warnings[idx]!,
      status: 'RESOLVED',
      resolved: op.resolved,
      note: op.note,
    }
    lines = replaceSectionBody(lines, range, renderWarningsBody(warnings))
    const newContent = lines.join('\n')
    assertSectionBound(originalLines, lines, range)
    return { content: newContent, before, after: warnings[idx]! }
  }
  if (op.op === 'reopen') {
    warnings[idx] = {
      ...warnings[idx]!,
      status: 'OPEN',
      resolved: null,
      note: null,
    }
    lines = replaceSectionBody(lines, range, renderWarningsBody(warnings))
    const newContent = lines.join('\n')
    assertSectionBound(originalLines, lines, range)
    return { content: newContent, before, after: warnings[idx]! }
  }
  if (op.op === 'delete') {
    const deleted = warnings[idx]!
    warnings.splice(idx, 1)
    lines = replaceSectionBody(lines, range, renderWarningsBody(warnings))
    const newContent = lines.join('\n')
    assertSectionBound(originalLines, lines, range)
    return { content: newContent, deleted }
  }
  throw new WarningOpError('BAD_REQUEST', `unknown op: ${(op as { op: string }).op}`)
}

/** Generate `w_<isoCreatedColonsToHyphens>_<4hex>`. */
export function generateRowId(created: string): string {
  return `w_${created.replace(/:/g, '-')}_${randomHex(4)}`
}

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex').slice(0, bytes)
}

// ---------- Section creation + replacement ----------

/**
 * Insert an empty `## Warnings` section at the canonical position:
 * after `## Caveats`, before `## Artifacts`. Falls back to before
 * `## Artifacts` if Caveats is missing; before `## New Hypotheses` if
 * Artifacts is also missing; else EOF.
 */
function insertWarningsSectionLines(lines: string[]): { lines: string[]; range: SectionRange } {
  const newSection = ['## Warnings', '', TABLE_HEADER, TABLE_SEPARATOR, '']
  // Find anchors.
  const anchorIdx = (heading: string): number => {
    const re = new RegExp(`^##\\s+${heading}\\s*$`)
    let inFence = false
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!
      if (/^```/.test(l)) {
        inFence = !inFence
        continue
      }
      if (inFence) continue
      if (re.test(l)) return i
    }
    return -1
  }
  const caveats = anchorIdx('Caveats')
  const artifacts = anchorIdx('Artifacts')
  const newHyp = anchorIdx('New Hypotheses')

  let insertAt: number
  if (artifacts !== -1) {
    insertAt = artifacts
  } else if (newHyp !== -1) {
    insertAt = newHyp
  } else if (caveats !== -1) {
    // Caveats exists but Artifacts/NewHyp don't: append after Caveats body.
    insertAt = nextH2OrEOF(lines, caveats)
  } else {
    insertAt = lines.length
  }

  // Ensure a blank line precedes the section if not already at start of file.
  const prefix: string[] = []
  if (insertAt > 0 && lines[insertAt - 1]!.trim() !== '') prefix.push('')
  const out = [...lines.slice(0, insertAt), ...prefix, ...newSection, ...lines.slice(insertAt)]
  const range = findWarningsSectionRange(out)
  if (!range) throw new WarningOpError('INTERNAL', 'inserted Warnings section but cannot relocate it')
  return { lines: out, range }
}

function nextH2OrEOF(lines: string[], from: number): number {
  let inFence = false
  for (let i = from + 1; i < lines.length; i++) {
    const l = lines[i]!
    if (/^```/.test(l)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    if (/^##\s+/.test(l)) return i
  }
  return lines.length
}

function replaceSectionBody(lines: string[], range: SectionRange, newBody: string[]): string[] {
  // Keep the heading line itself. Re-emit a single blank line before and
  // after the body table for readability.
  const before = lines.slice(0, range.headingLine + 1)
  const after = lines.slice(range.bodyEnd)
  // Trim leading/trailing empty lines from newBody to avoid stacking blanks.
  const body: string[] = ['', ...newBody, '']
  // Avoid blank-line stacking against `after`.
  while (after.length > 0 && body.length > 0 && body[body.length - 1] === '' && after[0] === '') {
    body.pop()
  }
  return [...before, ...body, ...after]
}

/**
 * Pre-flush diff assertion: lines outside the warnings section MUST match
 * the original (modulo at most one blank-line of seam padding when the
 * section was newly inserted). The heading line itself is preserved
 * (and asserted) on the existing-section path.
 */
function assertSectionBound(
  originalLines: string[],
  newLines: string[],
  _staleRange: SectionRange,
): void {
  const newRange = findWarningsSectionRange(newLines)
  if (!newRange) {
    throw new WarningOpError(
      'INTERNAL',
      'section-bound assertion failed: lost the section after write',
    )
  }
  const originalRange = findWarningsSectionRange(originalLines)

  if (originalRange) {
    // Existing section path: prefix and suffix must match exactly.
    const prefixOriginal = originalLines.slice(0, originalRange.headingLine)
    const prefixNew = newLines.slice(0, newRange.headingLine)
    if (!arraysEqual(prefixOriginal, prefixNew)) {
      throw new WarningOpError('INTERNAL', 'section-bound assertion failed: prefix lines differ')
    }
    const suffixOriginal = originalLines.slice(originalRange.bodyEnd)
    const suffixNew = newLines.slice(newRange.bodyEnd)
    if (!arraysEqual(suffixOriginal, suffixNew)) {
      throw new WarningOpError('INTERNAL', 'section-bound assertion failed: suffix lines differ')
    }
    if (originalLines[originalRange.headingLine] !== newLines[newRange.headingLine]) {
      throw new WarningOpError('INTERNAL', 'section-bound assertion failed: heading line differs')
    }
    return
  }
  // Insertion path: try several seam-trim variants. At most one blank
  // line of padding may have been added at the top and at the bottom of
  // the inserted section. Any other line difference is a violation.
  const before = newLines.slice(0, newRange.headingLine)
  const after = newLines.slice(newRange.bodyEnd)
  const trimTop = (arr: string[]): string[] =>
    arr.length > 0 && arr[arr.length - 1] === '' ? arr.slice(0, -1) : arr
  const trimBot = (arr: string[]): string[] =>
    arr.length > 0 && arr[0] === '' ? arr.slice(1) : arr
  const candidates: string[][] = [
    [...before, ...after],
    [...trimTop(before), ...after],
    [...before, ...trimBot(after)],
    [...trimTop(before), ...trimBot(after)],
  ]
  const targetA = trimTrailingBlanks(originalLines)
  for (const c of candidates) {
    if (arraysEqual(trimTrailingBlanks(c), targetA)) return
  }
  throw new WarningOpError(
    'INTERNAL',
    'section-bound assertion failed: lines outside ## Warnings differ pre/post (insertion path)',
  )
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function trimTrailingBlanks(arr: string[]): string[] {
  const out = [...arr]
  while (out.length > 0 && out[out.length - 1] === '') out.pop()
  return out
}
