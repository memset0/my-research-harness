// `memon journal read` — the one explicit diagnostic query over Journal history.
//
// Journal is developer-facing operation history, not research input: no manual
// append, no digest cursor, and no habitual inclusion in scans or handoffs.
//
// Two sources are merged and always labelled by origin:
//   * `legacy-markdown`      — the preserved `docs/journal.md` lines, reported
//     as what they literally say. Associations come only from the typed
//     identities the writers put on the line (backticked ids, `run=`,
//     `old=` / `new=`, `cascaded-runs=[…]`); anything else is reported as
//     unresolved rather than attached to a guessed Experiment or Run.
//   * `invocation-receipt`   — the typed ledger receipts under
//     `.memon/activity`, one per non-readonly invocation, including the ones
//     that failed, conflicted, changed nothing or never finished.

import { createHash } from 'node:crypto'
import {
  EXPERIMENT_DIR_REGEX,
  JOURNAL_INVOCATION_OUTCOMES,
  type JournalActivitySnapshot,
  type JournalEvent,
  type JournalInvocationRecord,
  type JournalSnapshot,
  readJournalActivity,
  readProjectJournal,
  RUN_DIR_REGEX,
  type UnreadableJournalReceipt,
} from '@memon/core'
import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { emitHuman, emitJson, type OutputFormat } from '../lib/output.js'

const DEFAULT_LIMIT = 200
const MAX_LIMIT = 1000
const CURSOR_VERSION = 1

/** Origin label for events parsed out of the legacy Markdown file. */
const LEGACY_ORIGIN = 'legacy-markdown'
/** Origin label for the typed invocation receipts under `.memon/activity`. */
const RECEIPT_ORIGIN = 'invocation-receipt'
/** Synthetic tag every receipt carries, so `--tag` stays meaningful. */
const RECEIPT_TAG = 'INVOCATION'

/** ISO8601 date-time that carries an explicit offset (or `Z`). */
const ISO_INSTANT_REGEX = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/
/** `E<NNNN>` without a slug — accepted shorthand for the experiment filter. */
const EXPERIMENT_ID_ONLY_REGEX = /^E\d{4}$/

/**
 * Which entity the backticked id on a legacy line denotes, per the tag that
 * wrote it. `either` means the tag was emitted for both Runs and Experiments
 * over the file's lifetime, so only the id shape can decide.
 */
const TAG_BACKTICK_KIND: Record<string, 'experiment' | 'run' | 'either'> = {
  STATUS: 'run',
  CREATE: 'run',
  EXP_STATUS: 'experiment',
  EXPERIMENT: 'experiment',
  BIND: 'experiment',
}

const RUN_TOKEN_REGEX = /\b(?:from-)?run=(\S+)/g
const CASCADED_RUNS_REGEX = /\bcascaded-runs=(\[[^\]]*\])/
const RENAME_TOKEN_REGEX = /\b(?:old|new)=(\S+)/g

export interface JournalReadInput {
  projectRoot?: string
  cwd: string
  format: OutputFormat
  since?: string
  tag?: string
  experimentId?: string
  runId?: string
  /** Raw `--limit` value; validated here so bad input fails instead of clamping. */
  limit?: string
  cursor?: string
  /** `legacy` / `invocation`: restrict the merged stream to one origin. */
  origin?: string
  /** Only invocation receipts with this outcome (implies `--origin invocation`). */
  outcome?: string
}

/** Typed identities a single event explicitly names. */
export interface EventAssociation {
  /** True when at least one typed identity was resolvable. */
  known: boolean
  experimentIds: string[]
  runIds: string[]
  /**
   * Typed targets that are neither Experiment nor Run (Wiki pages,
   * hypotheses, the project itself). Only receipts carry these; legacy lines
   * never named them.
   */
  otherIds: string[]
  /** References present on the event whose entity kind cannot be established. */
  unresolvedRefs: string[]
}

/** A preserved `docs/journal.md` line, reported as what it literally says. */
export interface LegacyDiagnosticEvent {
  origin: typeof LEGACY_ORIGIN
  timestamp: string
  tag: string
  body: string
  raw: string
  statusFrom: string | null
  statusTo: string | null
  association: EventAssociation
}

/** One invocation receipt: the ledger's record that a tool call happened. */
export interface ReceiptDiagnosticEvent {
  origin: typeof RECEIPT_ORIGIN
  timestamp: string
  tag: typeof RECEIPT_TAG
  id: string
  command: string
  /** `cli` / `web` — which surface issued the invocation. */
  invokedFrom: JournalInvocationRecord['origin']
  outcome: JournalInvocationRecord['outcome']
  errorCode: string | null
  /** `null` while the invocation is still running or was interrupted. */
  finishedAt: string | null
  parameters: Record<string, unknown>
  /** Project-relative paths the invocation reported changing. */
  changedPaths: string[]
  association: EventAssociation
}

export type DiagnosticEvent = LegacyDiagnosticEvent | ReceiptDiagnosticEvent

interface ResolvedFilters {
  since: string | null
  tag: string | null
  experimentId: string | null
  runId: string | null
  origin: typeof LEGACY_ORIGIN | typeof RECEIPT_ORIGIN | null
  outcome: string | null
  limit: number
}

export async function runJournalRead(input: JournalReadInput): Promise<void> {
  const filters: ResolvedFilters = {
    since: resolveSince(input.since),
    tag: resolveTag(input.tag),
    experimentId: resolveExperimentFilter(input.experimentId),
    runId: resolveRunFilter(input.runId),
    origin: resolveOriginFilter(input.origin, input.outcome),
    outcome: resolveOutcomeFilter(input.outcome),
    limit: resolveLimit(input.limit),
  }
  const sinceMs = filters.since === null ? null : Date.parse(filters.since)

  const ctx = await resolveContext({ projectRoot: input.projectRoot, cwd: input.cwd })
  const root = singleProjectRoot(ctx)

  const snapshot: JournalSnapshot = await readProjectJournal(root).catch((err: unknown) =>
    emitErrorAndExit('BAD_STATE', `cannot read legacy history: ${describeError(err)}`),
  )
  const activity: JournalActivitySnapshot = await readJournalActivity(root).catch((err: unknown) =>
    emitErrorAndExit('BAD_STATE', `cannot read invocation receipts: ${describeError(err)}`),
  )

  const legacy = snapshot.events.map(toLegacyEvent)
  const receipts = activity.records.map(toReceiptEvent)
  // Ascending by instant. Merged ordering is chronological, so receipts written
  // after a page was issued land at the END of the stream — an outstanding
  // cursor keeps pointing at the same events instead of skipping new ones.
  const all = [...legacy, ...receipts].sort(compareByInstant)

  const matched = all.filter((event) => matches(event, filters, sinceMs))

  const fingerprint = filterFingerprint(root, filters)
  const offset = input.cursor === undefined ? 0 : decodeCursor(input.cursor, fingerprint)
  if (offset > matched.length) {
    emitErrorAndExit(
      'BAD_REQUEST',
      `--cursor points past the end of the filtered stream (${matched.length} events); re-run the query without --cursor`,
    )
  }
  const page = matched.slice(offset, offset + filters.limit)
  const nextOffset = offset + page.length
  const nextCursor = nextOffset < matched.length ? encodeCursor(nextOffset, fingerprint) : null

  const payload: JournalReadPayload = {
    sources: [
      {
        origin: LEGACY_ORIGIN,
        path: snapshot.path,
        available: snapshot.path !== null,
        totalEvents: legacy.length,
        unparsableTimestamps: countUnparsable(legacy),
        parseErrors: snapshot.parseErrors,
        parseWarnings: snapshot.parseWarnings,
      },
      {
        origin: RECEIPT_ORIGIN,
        path: activity.dir,
        available: activity.dir !== null,
        totalEvents: receipts.length,
        unparsableTimestamps: countUnparsable(receipts),
        // A receipt file that cannot be decoded is reported, never dropped
        // silently: understated history reads as "it never happened".
        unreadable: activity.unreadable,
      },
    ],
    filters,
    matched: matched.length,
    returned: page.length,
    events: page,
    nextCursor,
  }

  if (input.format === 'human') {
    emitHuman(humanSummary(payload))
    return
  }
  emitJson(payload)
}

/** Diagnostic message for an unknown throw, without asserting its shape. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function toLegacyEvent(event: JournalEvent): LegacyDiagnosticEvent {
  return {
    origin: LEGACY_ORIGIN,
    timestamp: event.timestamp,
    tag: event.tag,
    body: event.body,
    raw: event.raw,
    statusFrom: event.statusFrom,
    statusTo: event.statusTo,
    association: deriveAssociation(event),
  }
}

function toReceiptEvent(record: JournalInvocationRecord): ReceiptDiagnosticEvent {
  const experimentIds: string[] = []
  const runIds: string[] = []
  const otherIds: string[] = []
  const unresolvedRefs: string[] = []
  const changedPaths: string[] = []
  for (const detail of record.details ?? []) {
    if (detail.kind === 'file-change') {
      changedPaths.push(detail.path)
      continue
    }
    if (detail.kind === 'target') {
      const bucket =
        detail.type === 'experiment' ? experimentIds : detail.type === 'run' ? runIds : otherIds
      if (!bucket.includes(detail.id)) bucket.push(detail.id)
      continue
    }
    // An intercepted legacy event carries only ids it could type; anything
    // whose shape is ambiguous stays unresolved rather than being guessed.
    for (const ref of detail.refs) {
      const kind = classify(ref)
      const bucket =
        kind === 'experiment' ? experimentIds : kind === 'run' ? runIds : unresolvedRefs
      if (!bucket.includes(ref)) bucket.push(ref)
    }
  }
  return {
    origin: RECEIPT_ORIGIN,
    timestamp: record.startedAt,
    tag: RECEIPT_TAG,
    id: record.id,
    command: record.command,
    invokedFrom: record.origin,
    outcome: record.outcome,
    errorCode: record.errorCode ?? null,
    finishedAt: record.finishedAt,
    parameters: record.parameters,
    changedPaths,
    association: {
      known: experimentIds.length > 0 || runIds.length > 0 || otherIds.length > 0,
      experimentIds,
      runIds,
      otherIds,
      unresolvedRefs,
    },
  }
}

/**
 * Chronological by instant, NOT by timestamp string: `…T09:00:00+00:00` is
 * later than `…T10:00:00+08:00`. Events whose timestamp cannot be decoded keep
 * their relative arrival order at the end rather than reshuffling the stream.
 */
function compareByInstant(a: DiagnosticEvent, b: DiagnosticEvent): number {
  const left = Date.parse(a.timestamp)
  const right = Date.parse(b.timestamp)
  const leftOk = Number.isFinite(left)
  const rightOk = Number.isFinite(right)
  if (leftOk && rightOk && left !== right) return left - right
  if (leftOk !== rightOk) return leftOk ? -1 : 1
  return 0
}

function countUnparsable(events: DiagnosticEvent[]): number {
  return events.filter((event) => !Number.isFinite(Date.parse(event.timestamp))).length
}

// ---------- filters ----------

function resolveSince(raw: string | undefined): string | null {
  if (raw === undefined) return null
  const value = raw.trim()
  if (!ISO_INSTANT_REGEX.test(value) || !Number.isFinite(Date.parse(value))) {
    emitErrorAndExit(
      'BAD_REQUEST',
      `--since must be an ISO8601 timestamp with an explicit offset (e.g. 2026-09-01T10:00:00+08:00), got: ${raw}`,
    )
  }
  return value
}

function resolveTag(raw: string | undefined): string | null {
  if (raw === undefined) return null
  const value = raw.trim().toUpperCase()
  if (value === '') {
    emitErrorAndExit('BAD_REQUEST', '--tag must be a non-empty event tag')
  }
  return value
}

function resolveExperimentFilter(raw: string | undefined): string | null {
  if (raw === undefined) return null
  const value = raw.trim()
  if (EXPERIMENT_DIR_REGEX.test(value) || EXPERIMENT_ID_ONLY_REGEX.test(value)) {
    return value
  }
  if (RUN_DIR_REGEX.test(value)) {
    emitErrorAndExit(
      'BAD_REQUEST',
      `--experiment-id got a run id "${value}"; filter runs with --run-id ${value}`,
    )
  }
  emitErrorAndExit(
    'BAD_REQUEST',
    `--experiment-id must be E<NNNN> or E<NNNN>-<slug>, got: ${value}`,
  )
}

function resolveRunFilter(raw: string | undefined): string | null {
  if (raw === undefined) return null
  const value = raw.trim()
  if (EXPERIMENT_DIR_REGEX.test(value) || EXPERIMENT_ID_ONLY_REGEX.test(value)) {
    emitErrorAndExit(
      'BAD_REQUEST',
      `--run-id got an experiment id "${value}"; filter experiments with --experiment-id ${value}`,
    )
  }
  if (!RUN_DIR_REGEX.test(value)) {
    emitErrorAndExit(
      'BAD_REQUEST',
      `--run-id must be a run directory name <slug>-<YYMMDD>-<HHMMSS>, got: ${value}`,
    )
  }
  return value
}

function resolveLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_LIMIT
  const value = raw.trim()
  const parsed = /^\d+$/.test(value) ? Number(value) : Number.NaN
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
    emitErrorAndExit(
      'BAD_REQUEST',
      `--limit must be an integer between 1 and ${MAX_LIMIT}, got: ${raw}`,
    )
  }
  return parsed
}

/**
 * `--origin legacy|invocation`. `--outcome` only exists on receipts, so
 * supplying it implies the receipt origin instead of silently returning
 * legacy lines that cannot carry an outcome.
 */
function resolveOriginFilter(
  raw: string | undefined,
  outcome: string | undefined,
): typeof LEGACY_ORIGIN | typeof RECEIPT_ORIGIN | null {
  if (raw === undefined) return outcome === undefined ? null : RECEIPT_ORIGIN
  const value = raw.trim().toLowerCase()
  if (value === 'legacy' || value === LEGACY_ORIGIN) {
    if (outcome !== undefined) {
      emitErrorAndExit(
        'BAD_REQUEST',
        '--outcome only applies to invocation receipts; drop --origin legacy or drop --outcome',
      )
    }
    return LEGACY_ORIGIN
  }
  if (value === 'invocation' || value === RECEIPT_ORIGIN) return RECEIPT_ORIGIN
  emitErrorAndExit('BAD_REQUEST', `--origin must be "legacy" or "invocation", got: ${raw}`)
}

function resolveOutcomeFilter(raw: string | undefined): string | null {
  if (raw === undefined) return null
  const value = raw.trim().toLowerCase()
  if (!(JOURNAL_INVOCATION_OUTCOMES as readonly string[]).includes(value)) {
    emitErrorAndExit(
      'BAD_REQUEST',
      `--outcome must be one of ${JOURNAL_INVOCATION_OUTCOMES.join(' | ')}, got: ${raw}`,
    )
  }
  return value
}

function matches(
  event: DiagnosticEvent,
  filters: ResolvedFilters,
  sinceMs: number | null,
): boolean {
  if (sinceMs !== null) {
    // Compare instants, not offset-carrying strings: `…T09:00:00+00:00` is
    // later than `…T10:00:00+08:00` even though it sorts earlier.
    const ms = Date.parse(event.timestamp)
    if (!Number.isFinite(ms) || ms < sinceMs) return false
  }
  if (filters.origin !== null && event.origin !== filters.origin) return false
  if (filters.outcome !== null) {
    if (event.origin !== RECEIPT_ORIGIN || event.outcome !== filters.outcome) return false
  }
  if (filters.tag !== null && event.tag.toUpperCase() !== filters.tag) return false
  if (filters.experimentId !== null) {
    const target = filters.experimentId
    // A bare `E0001` matches any slug of that Experiment; the full
    // `E0001-slug` form must match exactly.
    const hit = EXPERIMENT_ID_ONLY_REGEX.test(target)
      ? event.association.experimentIds.some((id) => id.startsWith(`${target}-`))
      : event.association.experimentIds.includes(target)
    if (!hit) return false
  }
  if (filters.runId !== null && !event.association.runIds.includes(filters.runId)) {
    return false
  }
  return true
}

// ---------- association ----------

function deriveAssociation(event: JournalEvent): EventAssociation {
  const experimentIds = new Set<string>()
  const runIds = new Set<string>()
  const unresolved = new Set<string>()

  const add = (token: string, expected: 'experiment' | 'run' | 'either'): void => {
    const shape = classify(token)
    if (shape === 'unknown' || (expected !== 'either' && shape !== expected)) {
      unresolved.add(token)
      return
    }
    if (shape === 'experiment') experimentIds.add(token)
    else runIds.add(token)
  }

  // `runId` on the parsed event is the first backticked token, whatever entity
  // the writing command meant by it.
  if (event.runId !== null) {
    add(event.runId, TAG_BACKTICK_KIND[event.tag] ?? 'either')
  }

  for (const match of event.body.matchAll(RUN_TOKEN_REGEX)) {
    const token = match[1]!
    if (token === 'null') continue
    add(token, 'run')
  }

  const cascaded = CASCADED_RUNS_REGEX.exec(event.body)
  if (cascaded) {
    let parsed: unknown
    try {
      parsed = JSON.parse(cascaded[1]!)
    } catch {
      unresolved.add(cascaded[1]!)
      parsed = null
    }
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (typeof entry === 'string' && entry !== '') add(entry, 'run')
      }
    }
  }

  for (const match of event.body.matchAll(RENAME_TOKEN_REGEX)) {
    add(match[1]!, 'either')
  }

  return {
    known: experimentIds.size > 0 || runIds.size > 0,
    experimentIds: [...experimentIds],
    runIds: [...runIds],
    // Legacy lines only ever named Experiments and Runs.
    otherIds: [],
    unresolvedRefs: [...unresolved],
  }
}

function classify(token: string): 'experiment' | 'run' | 'unknown' {
  const isExperiment = EXPERIMENT_DIR_REGEX.test(token)
  const isRun = RUN_DIR_REGEX.test(token)
  if (isExperiment && !isRun) return 'experiment'
  if (isRun && !isExperiment) return 'run'
  // Neither shape, or ambiguous enough to match both — report, never guess.
  return 'unknown'
}

// ---------- cursor ----------

/**
 * The cursor is a positional offset into the deterministically ordered,
 * already-filtered event stream, so a page boundary can never fall between
 * two events sharing a timestamp. It is bound to the project root and the
 * FULL filter set — including origin and outcome — so a cursor can never be
 * replayed against a different stream and silently return the wrong window;
 * an offset past the end of the current stream is rejected rather than
 * answered with an empty page.
 */
function filterFingerprint(root: string, filters: ResolvedFilters): string {
  const material = JSON.stringify([
    root,
    filters.since,
    filters.tag,
    filters.experimentId,
    filters.runId,
    filters.origin,
    filters.outcome,
  ])
  return createHash('sha1').update(material).digest('hex').slice(0, 16)
}

function encodeCursor(offset: number, fingerprint: string): string {
  const payload = JSON.stringify({ v: CURSOR_VERSION, offset, f: fingerprint })
  return Buffer.from(payload, 'utf8').toString('base64url')
}

function decodeCursor(raw: string, fingerprint: string): number {
  let decoded: { v?: unknown; offset?: unknown; f?: unknown }
  try {
    decoded = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
  } catch {
    emitErrorAndExit('BAD_REQUEST', '--cursor is not a journal read cursor')
  }
  if (decoded.v !== CURSOR_VERSION) {
    emitErrorAndExit('BAD_REQUEST', '--cursor was issued by an incompatible version')
  }
  if (decoded.f !== fingerprint) {
    emitErrorAndExit(
      'BAD_REQUEST',
      '--cursor was issued for a different project or filter set; re-run the query without --cursor',
    )
  }
  const offset = decoded.offset
  if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) {
    emitErrorAndExit('BAD_REQUEST', '--cursor carries an invalid position')
  }
  return offset
}

// ---------- human rendering ----------

interface JournalReadPayload {
  sources: {
    origin: string
    /** Legacy file path, or the activity directory; `null` when absent. */
    path: string | null
    available: boolean
    totalEvents: number
    unparsableTimestamps: number
    parseErrors?: unknown[]
    parseWarnings?: unknown[]
    unreadable?: UnreadableJournalReceipt[]
  }[]
  filters: ResolvedFilters
  matched: number
  returned: number
  events: DiagnosticEvent[]
  nextCursor: string | null
}

function humanSummary(payload: JournalReadPayload): string {
  const lines: string[] = []
  for (const source of payload.sources) {
    const unreadable = source.unreadable ?? []
    lines.push(
      `source: ${source.path ?? '(absent)'} [${source.origin}] ` +
        `${source.totalEvents} events` +
        (source.unparsableTimestamps > 0
          ? `, ${source.unparsableTimestamps} with unparsable timestamps`
          : '') +
        (unreadable.length > 0 ? `, ${unreadable.length} unreadable` : ''),
    )
  }
  lines.push(`matched: ${payload.matched}, returned: ${payload.returned}`)
  for (const event of payload.events) {
    lines.push(
      `${event.timestamp} [${event.tag}] ${describeAssociation(event)} ${describeBody(event)}`,
    )
  }
  lines.push(`next cursor: ${payload.nextCursor ?? '—'}`)
  return lines.join('\n')
}

/** Legacy lines show their preserved text; receipts show typed facts only. */
function describeBody(event: DiagnosticEvent): string {
  if (event.origin === LEGACY_ORIGIN) return event.body
  const changed = event.changedPaths.length > 0 ? ` files=${event.changedPaths.join(',')}` : ''
  const code = event.errorCode === null ? '' : ` code=${event.errorCode}`
  return `${event.command} (${event.invokedFrom}) outcome=${event.outcome}${code}${changed}`
}

function describeAssociation(event: DiagnosticEvent): string {
  const { experimentIds, runIds, otherIds, unresolvedRefs } = event.association
  const parts: string[] = []
  if (experimentIds.length > 0) parts.push(`exp=${experimentIds.join(',')}`)
  if (runIds.length > 0) parts.push(`run=${runIds.join(',')}`)
  if (otherIds.length > 0) parts.push(`target=${otherIds.join(',')}`)
  if (parts.length === 0) {
    parts.push(unresolvedRefs.length > 0 ? `unresolved=${unresolvedRefs.join(',')}` : 'unknown')
  }
  return `(${parts.join(' ')})`
}
