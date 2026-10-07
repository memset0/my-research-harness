// Journal invocation ledger — the non-readonly tool invocation history.
//
// The Journal is a ledger of *invocations*, not of successful object changes:
// a mutating CLI command or service mutation that failed, conflicted or
// changed nothing still happened, and diagnostics need to see it. Reads,
// polling, help, search, lint, validate and dry-runs are deliberately absent.
//
// Storage is one JSON receipt per invocation under
// `<projectRoot>/.memon/activity/<id>.json`:
//
//   * `begin` persists the `running` state before the action touches anything,
//     so a crashed or killed process leaves a visible unfinished invocation
//     instead of nothing at all.
//   * `finish` rewrites the same file with the terminal outcome. A finish that
//     cannot be persisted is reported to the host as an explicit recording
//     failure — it never rewrites the outcome as success, and it never rolls
//     back the research edit the action already made.
//
// Legacy `docs/journal.md` is untouched by this module. Native
// `appendJournalEvent` calls made *inside* an invocation are intercepted by
// `append.ts` into typed `legacy-event` details on the active record — tag,
// instant, typed ids and status transition only, never the historical prose —
// so the preserved file gains no new bytes and no event is duplicated.

import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes } from 'node:crypto'
import { mkdirSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from '@memon/file-protocol/paths'
import { z } from 'zod'
import { projectFs as fs } from '../project-file-store.js'
import { formatIsoLocal } from '../time.js'
import {
  EXPERIMENT_DIR_REGEX,
  EXPERIMENT_STATUS_VALUES,
  RUN_DIR_REGEX,
  STATUS_VALUES,
} from '../types.js'

/** Bumped when the on-disk receipt shape changes incompatibly. */
export const JOURNAL_INVOCATION_RECORD_VERSION = 1

/** Project-root-relative directory holding invocation receipts. */
export const JOURNAL_ACTIVITY_RELDIR = '.memon/activity'

export const JOURNAL_INVOCATION_OUTCOMES = [
  'running',
  'success',
  'failure',
  'conflict',
  'noop',
  'partial',
] as const

export const JournalInvocationOutcomeSchema = z.enum(JOURNAL_INVOCATION_OUTCOMES)
export type JournalInvocationOutcome = (typeof JOURNAL_INVOCATION_OUTCOMES)[number]

/** Terminal outcomes — `running` is only ever the pre-finish state. */
export type JournalInvocationTerminalOutcome = Exclude<JournalInvocationOutcome, 'running'>

export const JournalInvocationOriginSchema = z.enum(['cli', 'web'])
export type JournalInvocationOrigin = z.infer<typeof JournalInvocationOriginSchema>

/**
 * Typed detail entries. Bounded metadata only: identities, project-relative
 * paths and observed digests. Never source bodies, historical prose,
 * credentials or absolute paths.
 */
export const JournalInvocationDetailSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('target'),
    type: z.enum(['experiment', 'run', 'wiki', 'hypothesis', 'project']),
    id: z.string().min(1),
  }),
  z.object({
    kind: z.literal('file-change'),
    /** Project-root-relative, POSIX separators. */
    path: z.string().min(1),
    /** sha1 hex of the preimage; `null` when it was never observed. */
    before: z.string().min(1).nullable(),
    /** sha1 hex of the observed postimage; `null` when the file is gone. */
    after: z.string().min(1).nullable(),
  }),
  z.object({
    kind: z.literal('legacy-event'),
    tag: z.string().min(1),
    timestamp: z.string().min(1),
    /** Experiment / Run ids the historical line named, never its prose. */
    refs: z.array(z.string().min(1)),
    statusFrom: z.string().min(1).nullable(),
    statusTo: z.string().min(1).nullable(),
  }),
])
export type JournalInvocationDetail = z.infer<typeof JournalInvocationDetailSchema>

export const JournalInvocationRecordSchema = z.object({
  version: z.number().int().positive(),
  id: z.string().min(1),
  startedAt: z.string().min(1),
  finishedAt: z.string().min(1).nullable(),
  command: z.string().min(1),
  origin: JournalInvocationOriginSchema,
  parameters: z.record(z.unknown()),
  outcome: JournalInvocationOutcomeSchema,
  errorCode: z.string().min(1).optional(),
  details: z.array(JournalInvocationDetailSchema).optional(),
})
export type JournalInvocationRecord = z.infer<typeof JournalInvocationRecordSchema>

export interface JournalInvocationInput {
  /** Stable operation id, e.g. `experiment link` or `PUT /api/runs/:id/readme`. */
  command: string
  origin: JournalInvocationOrigin
  /** Sanitized before it is persisted; see `sanitizeInvocationParameters`. */
  parameters?: Record<string, unknown>
}

/** Reported when a receipt could not be persisted; never a silent success. */
export interface JournalRecordingFailure {
  invocationId: string
  projectRoot: string
  phase: 'begin' | 'finish'
  /** The outcome that could not be persisted. */
  outcome: JournalInvocationOutcome
  message: string
}

export interface JournalInvocationOptions {
  /**
   * Also install the invocation as the process-level ambient invocation, for
   * hosts whose command boundary is not a single callback (the CLI, whose
   * Commander pre/post action hooks are separate calls).
   *
   * Only legal for a short-lived, single-command process. A long-lived host
   * (`memon serve`) MUST NOT open an ambient
   * invocation: it would sit under every later request as an audit parent and
   * silently swallow their receipts. Those commands are classified as
   * host-scoped and open no invocation at all.
   */
  ambient?: boolean
  /**
   * Start a fresh record even when a scope is already active, instead of
   * joining it. This is what a *request* boundary wants: one HTTP request is
   * its own invocation, and it must never be absorbed into whatever scope
   * happened to be on the stack when its handler was registered.
   */
  standalone?: boolean
  /** Overrides the default one-line stderr warning. */
  onRecordingFailure?: (failure: JournalRecordingFailure) => void
}

/** What an action may tell the ledger about an outcome it does not throw for. */
export interface JournalInvocationContext {
  readonly id: string
  readonly projectRoot: string
  /** Last explicit mark wins; a thrown error still overrides `success`. */
  markOutcome(outcome: JournalInvocationTerminalOutcome, errorCode?: string): void
  addDetail(detail: JournalInvocationDetail): void
}

export interface JournalInvocationHandle {
  readonly id: string
  readonly context: JournalInvocationContext
  readonly finished: boolean
  /** Run `action` with this invocation active for ambient lookups. */
  run<T>(action: (ctx: JournalInvocationContext) => Promise<T>): Promise<T>
  /**
   * Persist the terminal state. Never throws — a host on an exit path cannot
   * handle a throw — and returns the recording failure (also passed to the
   * reporter) so the caller can surface it, or `null` on success.
   */
  finish(
    outcome?: JournalInvocationTerminalOutcome,
    errorCode?: string,
  ): Promise<JournalRecordingFailure | null>
  /** Classify a thrown error and persist the terminal state. */
  finishFromError(error: unknown): Promise<JournalRecordingFailure | null>
  /** Synchronous terminal write, for `process.exit` paths. Never throws. */
  finishSync(
    outcome?: JournalInvocationTerminalOutcome,
    errorCode?: string,
  ): JournalRecordingFailure | null
}

/**
 * Raised to the caller when an operation ran but its receipt is not durable.
 *
 * The operation's changes are NOT reverted — rolling back real research edits
 * to keep a log tidy would be worse than an incomplete log. The caller's job
 * is to report the partial state (a non-zero CLI exit, a mapped HTTP error),
 * never to claim plain success. `message` and `failure.message` carry a safe
 * code only: no paths, no filesystem layout.
 */
export class JournalRecordingError extends Error {
  readonly code = 'JOURNAL_RECORD_INCOMPLETE'

  constructor(readonly failure: JournalRecordingFailure) {
    super(
      `invocation ${failure.invocationId} could not be recorded (${failure.phase}: ${failure.message}); ` +
        'the operation completed and its changes were NOT reverted',
    )
    this.name = 'JournalRecordingError'
  }
}

interface InvocationState {
  readonly id: string
  readonly projectRoot: string
  /** `projectRoot` after following links; the containment boundary. */
  readonly realRoot: string
  readonly dir: string
  readonly file: string
  readonly startedAt: string
  readonly command: string
  readonly origin: JournalInvocationOrigin
  readonly parameters: Record<string, unknown>
  readonly details: JournalInvocationDetail[]
  outcome: JournalInvocationTerminalOutcome
  errorCode: string | undefined
  finished: boolean
  report: (failure: JournalRecordingFailure) => void
}

const als = new AsyncLocalStorage<InvocationState>()

/**
 * Process-level fallback for hosts that cannot wrap their command in one
 * callback (the CLI: Commander's pre/post action hooks are separate calls).
 * A CLI process runs exactly one command, so this is exact rather than a
 * heuristic; service hosts use the AsyncLocalStorage scope instead.
 */
let ambientState: InvocationState | null = null

const MAX_STRING_LENGTH = 256
const MAX_ARRAY_ITEMS = 32
const MAX_OBJECT_KEYS = 32
const MAX_DEPTH = 3

/** Keys whose values are never persisted, at any depth. */
const SECRET_KEY_REGEX =
  /(password|passwd|secret|token|credential|cookie|session|authorization|auth|apikey|api_key|private_key|bearer)/i
/** Keys that carry document bodies rather than identifying parameters. */
const BODY_KEY_REGEX =
  /^(body|content|stdin|stdinContent|markdown|text|message|note|reason|description|summary|patch|diff|env|environment)$/

/** The active invocation, or `null` outside every invocation scope. */
export function currentJournalInvocation(): JournalInvocationContext | null {
  const state = currentState()
  return state === null ? null : contextFor(state)
}

/** Mark the active invocation's outcome; a no-op outside an invocation. */
export function markJournalInvocationOutcome(
  outcome: JournalInvocationTerminalOutcome,
  errorCode?: string,
): void {
  const state = currentState()
  if (state === null) return
  state.outcome = outcome
  state.errorCode = errorCode
}

/** Attach a typed detail to the active invocation; a no-op outside one. */
export function addJournalInvocationDetail(detail: JournalInvocationDetail): void {
  const state = currentState()
  if (state === null) return
  pushDetail(state, detail)
}

/**
 * Internal hook for `append.ts`: absorb a native legacy event into the active
 * invocation instead of appending bytes to the preserved legacy file.
 * Returns `false` when there is no active invocation, in which case the
 * caller keeps its unchanged legacy behaviour.
 *
 * Only typed metadata crosses over. A legacy body is historical prose —
 * Warning text, user notes — and copying it into the new ledger would turn a
 * diagnostic receipt into a second, unreviewed prose store.
 */
export function captureLegacyJournalEvent(event: {
  timestamp: string
  tag: string
  body: string
}): boolean {
  const state = currentState()
  if (state === null) return false
  const transition = STATUS_TRANSITION_REGEX.exec(event.body)
  const from = transition?.[1]
  const to = transition?.[2]
  pushDetail(state, {
    kind: 'legacy-event',
    tag: event.tag,
    timestamp: event.timestamp,
    refs: extractTypedRefs(event.body),
    statusFrom: from !== undefined && KNOWN_STATUS_VALUES.has(from) ? from : null,
    statusTo: to !== undefined && KNOWN_STATUS_VALUES.has(to) ? to : null,
  })
  return true
}

/** `FROM -> TO`, in any of the arrow spellings the legacy writers used. */
const STATUS_TRANSITION_REGEX = /\b([A-Z][A-Z_]*)\s*(?:->|→|=>)\s*([A-Z][A-Z_]*)\b/
const KNOWN_STATUS_VALUES = new Set<string>([...STATUS_VALUES, ...EXPERIMENT_STATUS_VALUES])
const REF_SPLIT_REGEX = /[^A-Za-z0-9_-]+/
const MAX_REFS = 20

/**
 * Experiment / Run ids the line names, in first-appearance order. Tokens that
 * match neither canonical directory shape are dropped: an unrecognized word is
 * prose, and guessing an identity is worse than recording none.
 */
function extractTypedRefs(body: string): string[] {
  const refs: string[] = []
  for (const token of body.split(REF_SPLIT_REGEX)) {
    if (token === '' || refs.includes(token)) continue
    if (!EXPERIMENT_DIR_REGEX.test(token) && !RUN_DIR_REGEX.test(token)) continue
    refs.push(token)
    if (refs.length >= MAX_REFS) break
  }
  return refs
}

/**
 * Wrap one non-readonly operation in a ledger invocation.
 *
 * Outcomes the caller sees:
 *   * action succeeded, receipt durable  -> the action's own result
 *   * action threw                       -> that error, unchanged. The
 *     operation failure is what the caller must handle; a recording problem on
 *     top of it is reported to the failure reporter, never substituted for it.
 *   * action succeeded, receipt failed   -> `JournalRecordingError`. The
 *     changes stand (no rollback); the caller MUST surface the partial state
 *     instead of reporting plain success.
 *
 * Nested calls inside an active invocation join the outer record: internal
 * helper reuse cannot manufacture a second receipt for one invocation. That
 * join is scoped to ONE logical command or request — a service request
 * boundary passes `standalone: true` so it can never be absorbed into an
 * unrelated scope that outlived its own operation.
 */
export async function withJournalInvocation<T>(
  projectRoot: string,
  input: JournalInvocationInput,
  action: (ctx: JournalInvocationContext) => Promise<T>,
  options: JournalInvocationOptions = {},
): Promise<T> {
  const active = options.standalone === true ? null : currentState()
  if (active !== null) return await action(contextFor(active))

  const handle = await beginJournalInvocation(projectRoot, input, options)
  let result: T
  try {
    result = await handle.run(action)
  } catch (error) {
    // The operation's own error wins: it is what the caller has to handle, and
    // masking it with a logging error would lose the real cause.
    await handle.finishFromError(error)
    throw error
  }
  const failure = await handle.finish()
  if (failure !== null) throw new JournalRecordingError(failure)
  return result
}

/**
 * Open an invocation and persist its `running` state. Use this only when the
 * operation boundary is not a single callback (CLI hooks + exit paths);
 * otherwise prefer `withJournalInvocation`.
 */
export async function beginJournalInvocation(
  projectRoot: string,
  input: JournalInvocationInput,
  options: JournalInvocationOptions = {},
): Promise<JournalInvocationHandle> {
  const root = resolve(projectRoot)
  const id = newInvocationId()
  let realRoot = root
  let dir = join(root, ...JOURNAL_ACTIVITY_RELDIR.split('/'))
  let prepared: unknown = null
  try {
    realRoot = await realProjectRoot(root)
    dir = await ensureActivityDir(realRoot)
  } catch (error) {
    prepared = error
  }

  const state: InvocationState = {
    id,
    projectRoot: root,
    realRoot,
    dir,
    file: join(dir, `${id}.json`),
    startedAt: invocationTimestamp(),
    command: input.command,
    origin: input.origin,
    parameters: sanitizeInvocationParameters(input.parameters ?? {}, root),
    details: [],
    outcome: 'success',
    errorCode: undefined,
    finished: false,
    report: options.onRecordingFailure ?? defaultRecordingFailureReporter,
  }

  if (options.ambient === true) ambientState = state

  try {
    if (prepared !== null) throw prepared
    await writeRecord(state, snapshot(state, 'running'))
  } catch (error) {
    // A begin failure is reported but not fatal: the terminal write may still
    // land, and only a missing FINAL receipt makes the history lie.
    state.report({
      invocationId: id,
      projectRoot: root,
      phase: 'begin',
      outcome: 'running',
      message: sanitizeFailureMessage(error),
    })
  }

  return makeHandle(state, options.ambient === true)
}

/** Every readable receipt for a project, oldest first. */
export async function readJournalInvocations(
  projectRoot: string,
): Promise<JournalInvocationRecord[]> {
  return (await readJournalActivity(projectRoot)).records
}

export interface UnreadableJournalReceipt {
  /** Receipt file name inside `.memon/activity`. */
  file: string
  reason: string
}

export interface JournalActivitySnapshot {
  /** Absolute activity directory when it exists, `null` when absent. */
  dir: string | null
  records: JournalInvocationRecord[]
  /** Files present but not decodable as receipts — reported, never guessed. */
  unreadable: UnreadableJournalReceipt[]
}

/**
 * Read every receipt with its diagnostics. A missing directory is valid and
 * yields `dir: null`; a corrupt file is reported rather than silently dropped
 * so a diagnostic query cannot understate the recorded history.
 */
export async function readJournalActivity(projectRoot: string): Promise<JournalActivitySnapshot> {
  // Resolve before reading: a `.memon/activity` symlink pointing elsewhere
  // must not be able to inject foreign "history" into a project's diagnostics.
  let dir: string
  try {
    const realRoot = await realProjectRoot(projectRoot)
    dir = await fs.realpath(join(realRoot, ...JOURNAL_ACTIVITY_RELDIR.split('/')))
    if (!isWithin(realRoot, dir)) {
      throw new Error(`${JOURNAL_ACTIVITY_RELDIR} escapes the project root`)
    }
  } catch (error) {
    if (errorCodeOf(error) === 'ENOENT') return { dir: null, records: [], unreadable: [] }
    throw error
  }

  const records: JournalInvocationRecord[] = []
  const unreadable: UnreadableJournalReceipt[] = []
  for (const file of (await fs.readdir(dir)).sort()) {
    if (!file.endsWith('.json') || file.startsWith('.')) continue
    let raw: string
    try {
      // lstat, not stat: a symlinked receipt is not a receipt this project
      // wrote, so it is reported rather than followed.
      if (!(await fs.lstat(join(dir, file))).isFile()) {
        unreadable.push({ file, reason: 'not a regular file' })
        continue
      }
      raw = await fs.readFile(join(dir, file), 'utf8')
    } catch (error) {
      unreadable.push({ file, reason: messageOf(error) })
      continue
    }
    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(raw)
    } catch (error) {
      unreadable.push({ file, reason: `invalid JSON: ${messageOf(error)}` })
      continue
    }
    const parsed = JournalInvocationRecordSchema.safeParse(parsedJson)
    if (!parsed.success) {
      unreadable.push({ file, reason: `not a v${JOURNAL_INVOCATION_RECORD_VERSION} receipt` })
      continue
    }
    records.push(parsed.data)
  }

  records.sort(compareRecords)
  return { dir, records, unreadable }
}

/**
 * Reduce arbitrary invocation parameters to bounded, non-secret metadata:
 * secret-shaped keys are dropped, document bodies are replaced by their size,
 * absolute paths are relativized against the project root (or replaced when
 * they point outside it), long strings are truncated and containers are
 * capped in width and depth.
 */
export function sanitizeInvocationParameters(
  parameters: Record<string, unknown>,
  projectRoot: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  let keys = 0
  for (const [key, value] of Object.entries(parameters)) {
    if (value === undefined) continue
    if (keys >= MAX_OBJECT_KEYS) {
      out['…'] = 'truncated'
      break
    }
    keys += 1
    out[key] = sanitizeValue(key, value, resolve(projectRoot), 0)
  }
  return out
}

// ---------- internals ----------

function currentState(): InvocationState | null {
  const scoped = als.getStore()
  if (scoped !== undefined && !scoped.finished) return scoped
  if (ambientState !== null && !ambientState.finished) return ambientState
  return null
}

function contextFor(state: InvocationState): JournalInvocationContext {
  return {
    id: state.id,
    projectRoot: state.projectRoot,
    markOutcome(outcome, errorCode) {
      state.outcome = outcome
      state.errorCode = errorCode
    },
    addDetail(detail) {
      pushDetail(state, detail)
    },
  }
}

/**
 * Details are bounded: a cascade records its targets, not a per-helper log.
 * The ceiling is high enough that a whole-bundle direct-maintenance batch fits
 * (a target plus a file entry per path); callers that could exceed it must
 * reject the batch explicitly rather than let it be silently truncated here.
 */
export const JOURNAL_INVOCATION_MAX_DETAILS = 1024

function pushDetail(state: InvocationState, detail: JournalInvocationDetail): void {
  if (state.details.length >= JOURNAL_INVOCATION_MAX_DETAILS) return
  state.details.push(detail)
}

function makeHandle(state: InvocationState, ambient: boolean): JournalInvocationHandle {
  const release = (): void => {
    state.finished = true
    if (ambient && ambientState === state) ambientState = null
  }

  const writeTerminal = (
    terminal: JournalInvocationTerminalOutcome,
    code: string | undefined,
    write: () => void | Promise<void>,
  ): Promise<JournalRecordingFailure | null> | JournalRecordingFailure | null => {
    const failed = (error: unknown): JournalRecordingFailure => {
      const failure: JournalRecordingFailure = {
        invocationId: state.id,
        projectRoot: state.projectRoot,
        phase: 'finish',
        outcome: terminal,
        message: sanitizeFailureMessage(error),
      }
      state.report(failure)
      return failure
    }
    try {
      const pending = write()
      if (pending === undefined) return null
      return pending.then(
        () => null,
        (error: unknown) => failed(error),
      )
    } catch (error) {
      return failed(error)
    }
  }

  const handle: JournalInvocationHandle = {
    id: state.id,
    context: contextFor(state),
    get finished() {
      return state.finished
    },
    async run<T>(action: (ctx: JournalInvocationContext) => Promise<T>): Promise<T> {
      return await als.run(state, () => action(contextFor(state)))
    },
    async finish(outcome, errorCode) {
      if (state.finished) return null
      const terminal = outcome ?? state.outcome
      const code = outcome === undefined ? state.errorCode : errorCode
      release()
      return await writeTerminal(terminal, code, () =>
        writeRecord(state, snapshot(state, terminal, code)),
      )
    },
    async finishFromError(error) {
      const classified = classifyError(error)
      return await handle.finish(classified.outcome, classified.errorCode)
    },
    finishSync(outcome, errorCode) {
      if (state.finished) return null
      const terminal = outcome ?? state.outcome
      const code = outcome === undefined ? state.errorCode : errorCode
      release()
      const result = writeTerminal(terminal, code, () => {
        writeRecordSync(state, snapshot(state, terminal, code))
      })
      // The sync writer never returns a promise; this keeps the shared helper
      // honest for the type checker.
      return result instanceof Promise ? null : result
    },
  }
  return handle
}

/**
 * A thrown error is a failure receipt. Codes naming a conflict or a partial
 * result keep that distinction, since callers rely on it to tell "nothing
 * happened" from "some of it happened".
 */
export function classifyError(error: unknown): {
  outcome: JournalInvocationTerminalOutcome
  errorCode: string | undefined
} {
  const code = errorCodeOf(error)
  if (code !== undefined) {
    if (/CONFLICT/i.test(code)) return { outcome: 'conflict', errorCode: code }
    if (/PARTIAL/i.test(code)) return { outcome: 'partial', errorCode: code }
  }
  return { outcome: 'failure', errorCode: code }
}

function errorCodeOf(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object') return undefined
  if ('code' in error && typeof error.code === 'string' && error.code !== '') return error.code
  if ('errorCode' in error && typeof error.errorCode === 'string' && error.errorCode !== '') {
    return error.errorCode
  }
  return undefined
}

function snapshot(
  state: InvocationState,
  outcome: JournalInvocationOutcome,
  errorCode?: string,
): JournalInvocationRecord {
  const record: JournalInvocationRecord = {
    version: JOURNAL_INVOCATION_RECORD_VERSION,
    id: state.id,
    startedAt: state.startedAt,
    finishedAt: outcome === 'running' ? null : invocationTimestamp(),
    command: state.command,
    origin: state.origin,
    parameters: state.parameters,
    outcome,
  }
  if (errorCode !== undefined && errorCode !== '') record.errorCode = errorCode
  if (state.details.length > 0) record.details = [...state.details]
  return record
}

async function writeRecord(state: InvocationState, record: JournalInvocationRecord): Promise<void> {
  const dir = await ensureActivityDir(await realProjectRoot(state.projectRoot))
  const file = join(dir, `${state.id}.json`)
  const tmp = tmpPath(dir, state.id)
  await fs.writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  // rename() replaces the destination entry itself, so an attacker-planted
  // symlink at the receipt path is overwritten rather than followed.
  await fs.rename(tmp, file)
}

function writeRecordSync(state: InvocationState, record: JournalInvocationRecord): void {
  const dir = ensureActivityDirSync(realProjectRootSync(state.projectRoot))
  const file = join(dir, `${state.id}.json`)
  const tmp = tmpPath(dir, state.id)
  writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  renameSync(tmp, file)
}

function tmpPath(dir: string, id: string): string {
  return join(dir, `.${id}.${randomBytes(3).toString('hex')}.tmp`)
}

/**
 * The activity directory, created if needed, with every segment verified to
 * stay inside the real project root.
 *
 * `.memon` or `.memon/activity` may be a symlink an unrelated process planted
 * (or a stale link from a moved project). Following it would write receipts —
 * and later read them back as history — from outside the project, so each
 * segment is created then resolved and checked. `mkdir` on an existing
 * symlink fails with EEXIST, which is exactly why the check follows it.
 */
async function ensureActivityDir(realRoot: string): Promise<string> {
  let current = realRoot
  for (const segment of JOURNAL_ACTIVITY_RELDIR.split('/')) {
    const next = join(current, segment)
    try {
      await fs.mkdir(next)
    } catch (error) {
      if (errorCodeOf(error) !== 'EEXIST') throw error
    }
    current = await fs.realpath(next)
    if (!isWithin(realRoot, current)) {
      throw new Error(`${JOURNAL_ACTIVITY_RELDIR} escapes the project root`)
    }
    if (!(await fs.stat(current)).isDirectory()) {
      throw new Error(`${JOURNAL_ACTIVITY_RELDIR} is not a directory`)
    }
  }
  return current
}

/** Synchronous twin of `ensureActivityDir`, for `process.exit` paths. */
function ensureActivityDirSync(realRoot: string): string {
  let current = realRoot
  for (const segment of JOURNAL_ACTIVITY_RELDIR.split('/')) {
    const next = join(current, segment)
    try {
      mkdirSync(next)
    } catch (error) {
      if (errorCodeOf(error) !== 'EEXIST') throw error
    }
    current = realpathSync(next)
    if (!isWithin(realRoot, current)) {
      throw new Error(`${JOURNAL_ACTIVITY_RELDIR} escapes the project root`)
    }
    if (!statSync(current).isDirectory()) {
      throw new Error(`${JOURNAL_ACTIVITY_RELDIR} is not a directory`)
    }
  }
  return current
}

async function realProjectRoot(projectRoot: string): Promise<string> {
  const real = await fs.realpath(projectRoot)
  if (!(await fs.stat(real)).isDirectory()) throw new Error('project root is not a directory')
  return real
}

function realProjectRootSync(projectRoot: string): string {
  const real = realpathSync(projectRoot)
  if (!statSync(real).isDirectory()) throw new Error('project root is not a directory')
  return real
}

/** Lexical containment of an already-resolved path. */
function isWithin(root: string, target: string): boolean {
  if (target === root) return true
  const rel = relative(root, target)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

function invocationTimestamp(): string {
  const now = new Date()
  const local = formatIsoLocal(now)
  return `${local.slice(0, 19)}.${String(now.getMilliseconds()).padStart(3, '0')}${local.slice(19)}`
}

/**
 * `<YYYYMMDD>-<HHMMSS>-<random>`: sortable by wall clock in a directory
 * listing, unique across concurrent writers on the same second.
 */
function newInvocationId(): string {
  const now = new Date()
  const stamp = [
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('')
  return `${stamp}-${randomBytes(4).toString('hex')}`
}

function compareRecords(a: JournalInvocationRecord, b: JournalInvocationRecord): number {
  const left = Date.parse(a.startedAt)
  const right = Date.parse(b.startedAt)
  const leftOk = Number.isFinite(left)
  const rightOk = Number.isFinite(right)
  // Receipts with an undecodable timestamp sort last rather than reorder the
  // decodable history around an arbitrary NaN comparison.
  if (leftOk && rightOk && left !== right) return left - right
  if (leftOk !== rightOk) return leftOk ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function defaultRecordingFailureReporter(failure: JournalRecordingFailure): void {
  process.stderr.write(
    `${JSON.stringify({
      warning: {
        code: 'JOURNAL_RECORD_INCOMPLETE',
        message:
          `the operation ran but its ${failure.phase} receipt could not be persisted: ` +
          failure.message,
        details: { invocationId: failure.invocationId, outcome: failure.outcome },
      },
    })}\n`,
  )
}

/**
 * Diagnostic text for a receipt-write failure, safe to hand to a caller or an
 * HTTP client: the errno / error name only. Filesystem messages carry absolute
 * paths, and the ledger must not leak machine layout on its own error path.
 */
function sanitizeFailureMessage(error: unknown): string {
  const code = errorCodeOf(error)
  if (code !== undefined) return code
  if (error instanceof Error && error.message !== '') {
    // Own errors are written without paths on purpose; foreign ones are
    // reduced to a class name.
    return error.name === 'Error' ? error.message : error.name
  }
  return 'unknown recording failure'
}

/** Reason text for a receipt file that could not be decoded. */
function messageOf(error: unknown): string {
  const code = errorCodeOf(error)
  const message = error instanceof Error ? error.message : String(error)
  return code === undefined ? message : `${code}: ${message}`
}

function sanitizeValue(key: string, value: unknown, root: string, depth: number): unknown {
  if (SECRET_KEY_REGEX.test(key)) return '[redacted]'
  if (value === null) return null
  if (typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'string') {
    if (BODY_KEY_REGEX.test(key)) return `[omitted ${value.length} chars]`
    return sanitizeString(value, root)
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) return `[array of ${value.length}]`
    const items = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeValue(key, item, root, depth + 1))
    if (value.length > MAX_ARRAY_ITEMS) items.push(`[+${value.length - MAX_ARRAY_ITEMS} more]`)
    return items
  }
  if (typeof value === 'object') {
    if (depth >= MAX_DEPTH) return '[object]'
    const out: Record<string, unknown> = {}
    let count = 0
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      if (childValue === undefined) continue
      if (count >= MAX_OBJECT_KEYS) {
        out['…'] = 'truncated'
        break
      }
      count += 1
      out[childKey] = sanitizeValue(childKey, childValue, root, depth + 1)
    }
    return out
  }
  // Functions, symbols and undefined carry no diagnostic value.
  return `[${typeof value}]`
}

function sanitizeString(value: string, root: string): string {
  const path = relativizePath(value, root)
  return path.length > MAX_STRING_LENGTH ? `${path.slice(0, MAX_STRING_LENGTH)}…[truncated]` : path
}

/**
 * Absolute paths never reach disk: inside the project they become
 * project-relative, outside they are replaced by a marker. Machine layout is
 * not diagnostic information the ledger is allowed to leak.
 */
function relativizePath(value: string, root: string): string {
  if (!isAbsolute(value)) return value
  const abs = resolve(value)
  if (abs === root) return '.'
  const rel = relative(root, abs)
  if (rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)) {
    return rel.split(sep).join('/')
  }
  return '[external path]'
}
