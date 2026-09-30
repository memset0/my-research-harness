// Owner-only File access settings: read effective/pending values, validate a
// proposed edit, persist it to the selected local instance config, and expose
// the machine-local restart adapter.
//
// Two distinct value sets exist and MUST NOT be conflated:
//
//   - `effective`  — what the running process actually uses. The Store applies
//                    `configureProjectFileStore()` once at startup, so the
//                    config object the Runtime loaded at init IS the effective
//                    snapshot for the lifetime of the process.
//   - `pending`    — what the config file on disk currently says. Saving only
//                    changes this; nothing is hot-applied and nothing restarts.
//
// Saving preserves every unrelated key AND every comment: the file is edited
// through a `yaml` Document (CST-backed), only the scheduler and cache-period
// scalars are assigned, and the result is written atomically behind both a
// content-revision guard (concurrent editor detection) and an mtime/size
// re-check (write race).
//
// Restart is never derived from request input. The only accepted command is the
// machine-local `fileAccessRestart` argv from the instance config; when absent
// or malformed the caller is told a manual restart is required rather than
// being given a fake success.

import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { DEFAULT_FILE_ACCESS_OPTIONS, type FileAccessOptions } from '@memon/core'
import { type Document, isMap, type ParsedNode, parseDocument } from 'yaml'
import { z } from 'zod'
import type { FileAccessOptionsDto } from '../file-access-api'

/** Top-level instance-config key holding the persisted (pending) settings. */
export const FILE_ACCESS_CONFIG_KEY = 'fileAccess'
/** Top-level instance-config key holding the machine-local restart argv. */
export const FILE_ACCESS_RESTART_CONFIG_KEY = 'fileAccessRestart'

/** Delay between flushing the HTTP response and spawning the restart argv. */
export const RESTART_SCHEDULE_DELAY_MS = 250

/** Metrics windows the panel may request. Reads touch no project disk. */
export const DEFAULT_METRICS_WINDOW_MS = 300_000
export const MIN_METRICS_WINDOW_MS = 1_000
export const MAX_METRICS_WINDOW_MS = 900_000

const MAX_PERIOD_MS = 86_400_000 // 24h — beyond this a period is a typo, not a policy
const MAX_CONCURRENCY = 1_024
const MAX_BACKOFF_FACTOR = 64
const MAX_RESTART_ARGV_LENGTH = 32
const MAX_RESTART_ARG_BYTES = 4_096

/**
 * The twelve tunables, in presentation order. Kept as a const tuple so the YAML
 * writer and the comparison helper iterate exactly the documented key set.
 */
const SCHEDULER_OPTION_KEYS = [
  'concurrency',
  'heartbeatMs',
  'leaseMs',
  'fileMinMs',
  'fileMaxMs',
  'directoryMinMs',
  'directoryMaxMs',
  'maintenanceMinMs',
  'maintenanceMaxMs',
  'failureMinMs',
  'failureMaxMs',
  'backoffFactor',
] as const satisfies readonly (keyof FileAccessOptions)[]

export const FILE_ACCESS_OPTION_KEYS = [
  ...SCHEDULER_OPTION_KEYS,
  'wikiTtlMs',
  'defaultTtlMs',
] as const

export type FileAccessSettingsErrorCode =
  | 'CONFIG_UNAVAILABLE'
  | 'CONFIG_SHAPE'
  | 'CONFIG_NOT_WRITABLE'
  | 'REVISION_CONFLICT'
  | 'SAVE_FAILED'

export class FileAccessSettingsError extends Error {
  constructor(
    public readonly code: FileAccessSettingsErrorCode,
    message: string,
    /** Present on REVISION_CONFLICT so the panel can offer a reload. */
    public readonly current?: PendingFileAccessSettings,
  ) {
    super(message)
    this.name = 'FileAccessSettingsError'
  }
}

export interface PendingFileAccessSettings {
  /** On-disk values merged over the compiled-in defaults. */
  pending: FileAccessOptionsDto
  /** Content revision of the whole config file; the concurrent-edit guard. */
  revision: string
}

export type RestartAdapter =
  | { status: 'available'; argv: readonly string[] }
  | { status: 'missing' }
  | { status: 'invalid'; message: string }

// ---------------------------------------------------------------------------
// Reading configuration
// ---------------------------------------------------------------------------

/**
 * Lenient view of the two config keys this module owns. Deliberately tolerant:
 * the loader schema is the authority, and a settings panel must still render
 * (falling back to defaults) rather than 500 on a hand-edited value.
 */
const FileAccessConfigViewSchema = z.object({
  [FILE_ACCESS_CONFIG_KEY]: z.record(z.string(), z.unknown()).optional(),
  [FILE_ACCESS_RESTART_CONFIG_KEY]: z.unknown().optional(),
  fileCache: z
    .object({
      dumpPath: z.string(),
      dumpIntervalMs: z.number(),
      wikiTtlMs: z.number(),
      defaultTtlMs: z.number(),
    })
    .optional(),
  file_cache: z
    .object({
      dump_path: z.string().optional(),
      dump_interval_seconds: z.number().optional(),
      wiki_ttl_seconds: z.number().optional(),
      default_ttl_seconds: z.number().optional(),
    })
    .optional(),
})

/**
 * Values the running process is actually using when passed the config loaded at
 * startup, and the persisted values when passed a freshly parsed config file.
 * Unusable entries fall back to the compiled-in default for that single key.
 */
export function resolveFileAccessOptions(config: unknown): FileAccessOptionsDto {
  const resolved: FileAccessOptionsDto = {
    ...DEFAULT_FILE_ACCESS_OPTIONS,
    wikiTtlMs: 30_000,
    defaultTtlMs: 1_800_000,
  }
  const view = FileAccessConfigViewSchema.safeParse(config)
  if (!view.success) return resolved
  const block = view.data[FILE_ACCESS_CONFIG_KEY]
  for (const key of SCHEDULER_OPTION_KEYS) {
    const value = block?.[key]
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) resolved[key] = value
  }
  const cache = view.data.fileCache
  const raw = view.data.file_cache
  const wiki = cache?.wikiTtlMs ?? (raw?.wiki_ttl_seconds ?? 30) * 1000
  const other = cache?.defaultTtlMs ?? (raw?.default_ttl_seconds ?? 1800) * 1000
  if (Number.isFinite(wiki) && wiki > 0) resolved.wikiTtlMs = wiki
  if (Number.isFinite(other) && other > 0) resolved.defaultTtlMs = other
  return resolved
}

/** Exported domain comparison: drives `restartRequired` in the API response. */
export function fileAccessOptionsEqual(a: FileAccessOptionsDto, b: FileAccessOptionsDto): boolean {
  return FILE_ACCESS_OPTION_KEYS.every((key) => a[key] === b[key])
}

const RestartArgvSchema = z
  .array(
    z
      .string()
      .min(1, 'arguments must be non-empty strings')
      .refine((arg) => !arg.includes('\0'), 'arguments must not contain NUL bytes')
      .refine(
        (arg) => Buffer.byteLength(arg, 'utf8') <= MAX_RESTART_ARG_BYTES,
        `arguments must be at most ${MAX_RESTART_ARG_BYTES} bytes`,
      ),
    { invalid_type_error: 'must be an argv list of strings' },
  )
  .min(1, 'must be a non-empty argv list')
  .max(MAX_RESTART_ARGV_LENGTH, `must have at most ${MAX_RESTART_ARGV_LENGTH} arguments`)

/**
 * Resolve the machine-local restart adapter. Nothing here can originate from a
 * request: only the instance config may name a command.
 */
export function resolveRestartAdapter(config: unknown): RestartAdapter {
  const view = FileAccessConfigViewSchema.safeParse(config)
  const raw = view.success ? view.data[FILE_ACCESS_RESTART_CONFIG_KEY] : undefined
  if (raw === undefined || raw === null) return { status: 'missing' }

  const argv = RestartArgvSchema.safeParse(raw)
  if (!argv.success) {
    const first = argv.error.issues[0]
    return {
      status: 'invalid',
      message: `${FILE_ACCESS_RESTART_CONFIG_KEY} ${first?.message ?? 'is not a valid argv list'}`,
    }
  }
  return { status: 'available', argv: argv.data }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const periodMs = z.number().int().positive().max(MAX_PERIOD_MS)

const FileAccessOptionsSchema = z
  .object({
    concurrency: z.number().int().positive().max(MAX_CONCURRENCY),
    heartbeatMs: periodMs,
    leaseMs: periodMs,
    fileMinMs: periodMs,
    fileMaxMs: periodMs,
    directoryMinMs: periodMs,
    directoryMaxMs: periodMs,
    maintenanceMinMs: periodMs,
    maintenanceMaxMs: periodMs,
    failureMinMs: periodMs,
    failureMaxMs: periodMs,
    backoffFactor: z.number().finite().gt(1).max(MAX_BACKOFF_FACTOR),
    wikiTtlMs: z.number().int().min(1000).max(2_592_000_000).multipleOf(1000),
    defaultTtlMs: z.number().int().min(1000).max(2_592_000_000).multipleOf(1000),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ranges = [
      ['fileMinMs', 'fileMaxMs', 'active file check'],
      ['directoryMinMs', 'directoryMaxMs', 'directory list check'],
      ['maintenanceMinMs', 'maintenanceMaxMs', 'maintenance'],
      ['failureMinMs', 'failureMaxMs', 'failure backoff'],
      ['wikiTtlMs', 'defaultTtlMs', 'persistent SSHFS cache'],
    ] as const
    for (const [minKey, maxKey, label] of ranges) {
      if (value[minKey] > value[maxKey]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [maxKey],
          message: `${minKey} must be less than or equal to ${maxKey} (${label} period range)`,
        })
      }
    }
    if (value.leaseMs < 3 * value.heartbeatMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['leaseMs'],
        message: 'leaseMs must be at least 3x heartbeatMs to survive a missed heartbeat',
      })
    }
  })

export type SettingsValidation =
  | { ok: true; settings: FileAccessOptionsDto }
  | { ok: false; issues: string[] }

/**
 * Validate a proposed settings object: exactly the documented keys, finite
 * positive numbers within sane bounds, and the interval relationships the
 * scheduler depends on. Every failure is reported, not just the first.
 */
export function validateFileAccessSettings(input: unknown): SettingsValidation {
  const parsed = FileAccessOptionsSchema.safeParse(input)
  if (parsed.success) return { ok: true, settings: parsed.data }
  const issues = parsed.error.issues.map((issue) => {
    const field = issue.path.join('.')
    return field ? `${field}: ${issue.message}` : issue.message
  })
  return { ok: false, issues }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Whole-file content revision: a truncated sha256 of the config text. It
 * changes on ANY edit (including unrelated keys and comments), which is exactly
 * what the concurrent-edit guard must detect.
 */
function computeRevision(text: string): string {
  return `sha256-${createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 32)}`
}

interface ConfigSnapshot {
  text: string
  mode: number
  revision: string
}

async function readConfigSnapshot(configPath: string): Promise<ConfigSnapshot> {
  try {
    const handle = await fs.open(configPath, 'r')
    try {
      const stat = await handle.stat()
      const text = (await handle.readFile()).toString('utf8')
      return { text, mode: stat.mode & 0o777, revision: computeRevision(text) }
    } finally {
      await handle.close()
    }
  } catch (error) {
    // The underlying message names a filesystem path; log it, don't return it.
    console.error(`memon: file access settings config unreadable: ${(error as Error).message}`)
    throw new FileAccessSettingsError('CONFIG_UNAVAILABLE', 'the instance config is not readable')
  }
}

/** Parsed instance-config document whose root is known to be a mapping. */
type InstanceConfigDocument = Document.Parsed<ParsedNode>

function parseConfigText(text: string): InstanceConfigDocument {
  const doc = parseDocument(text)
  if (doc.errors.length > 0) {
    // Parser messages quote the offending source line; keep them server-side.
    console.error(
      `memon: file access settings config is not valid YAML: ${doc.errors[0]?.message ?? 'parse error'}`,
    )
    throw new FileAccessSettingsError('CONFIG_SHAPE', 'the instance config is not valid YAML')
  }
  if (doc.contents !== null && !isMap(doc.contents)) {
    throw new FileAccessSettingsError('CONFIG_SHAPE', 'instance config root must be a mapping')
  }
  return doc
}

/** Current on-disk (pending) settings plus the revision used as an edit guard. */
export async function readPendingFileAccessSettings(
  configPath: string,
): Promise<PendingFileAccessSettings> {
  const snapshot = await readConfigSnapshot(configPath)
  const doc = parseConfigText(snapshot.text)
  return {
    pending: resolveFileAccessOptions(doc.toJS({ maxAliasCount: 100 })),
    revision: snapshot.revision,
  }
}

export interface SaveFileAccessSettingsInput {
  configPath: string
  /** Revision the editor loaded; a mismatch is a concurrent edit. */
  revision: string
  settings: FileAccessOptionsDto
}

// One in-flight save per config path, process-wide (Next bundles each route
// separately, hence the globalThis slot). Without this, two owner requests
// holding the same revision could both pass the guard and last-write-win.
// The stored tail never rejects, so a failed save cannot poison the chain.
const SAVE_QUEUE_KEY = Symbol.for('memon.fileAccessSaveQueue')

function saveQueue(): Map<string, Promise<void>> {
  const host = globalThis as unknown as Record<symbol, Map<string, Promise<void>> | undefined>
  const existing = host[SAVE_QUEUE_KEY]
  if (existing) return existing
  const created = new Map<string, Promise<void>>()
  host[SAVE_QUEUE_KEY] = created
  return created
}

/**
 * Persist pending settings atomically. Never applies them to the running
 * process and never restarts anything. Saves against one config path are
 * serialized, so the second of two same-revision requests sees the first
 * write and reports a conflict instead of discarding it. External editors
 * remain optimistic: the guard is the whole-file revision, re-checked
 * immediately before the rename.
 */
export async function saveFileAccessSettings(
  input: SaveFileAccessSettingsInput,
): Promise<PendingFileAccessSettings> {
  const queue = saveQueue()
  const predecessor = queue.get(input.configPath) ?? Promise.resolve()
  const result = predecessor.then(() => writeFileAccessSettings(input))
  const tail = result.then(
    () => undefined,
    () => undefined,
  )
  queue.set(input.configPath, tail)
  try {
    return await result
  } finally {
    if (queue.get(input.configPath) === tail) queue.delete(input.configPath)
  }
}

function conflict(message: string, snapshot: ConfigSnapshot): FileAccessSettingsError {
  return new FileAccessSettingsError('REVISION_CONFLICT', message, {
    pending: resolveFileAccessOptions(parseConfigText(snapshot.text).toJS({ maxAliasCount: 100 })),
    revision: snapshot.revision,
  })
}

async function writeFileAccessSettings(
  input: SaveFileAccessSettingsInput,
): Promise<PendingFileAccessSettings> {
  const { configPath, revision, settings } = input

  if (/(^|\/)config\.example\.ya?ml$/.test(configPath)) {
    throw new FileAccessSettingsError(
      'CONFIG_NOT_WRITABLE',
      'refusing to write the source-controlled config template; select a real instance config',
    )
  }

  const snapshot = await readConfigSnapshot(configPath)
  if (snapshot.revision !== revision) {
    throw conflict('the instance config changed since the settings panel loaded it', snapshot)
  }

  // Rewrite through the Document so surrounding keys, ordering, anchors and
  // comments (including comments inside the block) survive; only the twelve
  // scalars are reassigned.
  const doc = parseConfigText(snapshot.text)
  const existingBlock = doc.contents === null ? undefined : doc.get(FILE_ACCESS_CONFIG_KEY, true)
  if (existingBlock !== undefined && existingBlock !== null && !isMap(existingBlock)) {
    throw new FileAccessSettingsError(
      'CONFIG_SHAPE',
      `config key \`${FILE_ACCESS_CONFIG_KEY}\` must be a mapping of settings`,
    )
  }
  for (const key of SCHEDULER_OPTION_KEYS) {
    doc.setIn([FILE_ACCESS_CONFIG_KEY, key], settings[key])
  }
  const dumpPath = doc.getIn(['file_cache', 'dump_path'])
  if (typeof dumpPath === 'string' && dumpPath.trim()) {
    doc.setIn(['file_cache', 'wiki_ttl_seconds'], settings.wikiTtlMs / 1000)
    doc.setIn(['file_cache', 'default_ttl_seconds'], settings.defaultTtlMs / 1000)
  } else if (settings.wikiTtlMs !== 30_000 || settings.defaultTtlMs !== 1_800_000) {
    throw new FileAccessSettingsError(
      'CONFIG_SHAPE',
      'configure a local file_cache.dump_path before changing persistent cache periods',
    )
  }
  // lineWidth 0 disables re-folding, so untouched long scalars keep their shape.
  const rendered = doc.toString({ lineWidth: 0 })
  const newText = rendered.endsWith('\n') ? rendered : `${rendered}\n`

  if (newText === snapshot.text) {
    return { pending: resolveFileAccessOptions(doc.toJS({ maxAliasCount: 100 })), revision }
  }

  // Second guard: re-read the file and compare the whole-file revision, not
  // stat metadata, so an edit that reuses the mtime/size cannot be clobbered.
  const beforeWrite = await readConfigSnapshot(configPath)
  if (beforeWrite.revision !== snapshot.revision) {
    throw conflict('the instance config was modified while the save was in flight', beforeWrite)
  }

  const tmp = `${configPath}.file-access-tmp.${process.pid}.${randomBytes(6).toString('hex')}`
  try {
    // Same mode as the original: service-token configs stay 0600.
    await fs.writeFile(tmp, newText, { flag: 'wx', mode: beforeWrite.mode })
    if (process.platform !== 'win32') await fs.chmod(tmp, beforeWrite.mode)
    await fs.rename(tmp, configPath)
  } catch (error) {
    await fs.rm(tmp, { force: true })
    // The message may name paths; keep it in the server log only.
    console.error(`memon: file access settings write failed: ${(error as Error).message}`)
    throw new FileAccessSettingsError('SAVE_FAILED', 'could not write the instance config')
  }

  return {
    pending: resolveFileAccessOptions(parseConfigText(newText).toJS({ maxAliasCount: 100 })),
    revision: computeRevision(newText),
  }
}

// ---------------------------------------------------------------------------
// Restart
// ---------------------------------------------------------------------------

export type RestartOutcome =
  | { ok: true; code: 'RESTART_SCHEDULED' | 'RESTART_ALREADY_SCHEDULED'; delayMs: number }
  | { ok: false; code: 'RESTART_REQUIRED' | 'RESTART_ADAPTER_INVALID'; message: string }

interface RestartState {
  scheduled: boolean
}

// Next bundles route handlers separately; one process-global slot keeps the
// single-shot guarantee no matter which bundle serves the request.
const RESTART_STATE_KEY = Symbol.for('memon.fileAccessRestartState')

function restartState(): RestartState {
  const host = globalThis as unknown as Record<symbol, RestartState | undefined>
  const existing = host[RESTART_STATE_KEY]
  if (existing) return existing
  const created: RestartState = { scheduled: false }
  host[RESTART_STATE_KEY] = created
  return created
}

/** Test seam: forget a previously scheduled restart. */
export function resetRestartScheduleForTests(): void {
  restartState().scheduled = false
}

export interface ScheduleRestartOptions {
  /** Instance config path; only its directory is used as the spawn cwd. */
  configPath: string
  delayMs?: number
  /** Test seam / DI boundary. Production spawns a detached child. */
  spawnImpl?: (argv: readonly string[], cwd: string) => void
}

/**
 * Spawn the adapter detached. `onFailure` runs when the adapter never took
 * effect — the spawn errored, or it exited non-zero while this process is
 * still alive — so the owner can retry instead of being stuck on
 * "already scheduled" forever. A successful restart kills this process before
 * either callback can matter.
 */
function spawnDetachedRestart(argv: readonly string[], cwd: string, onFailure: () => void): void {
  const [command, ...args] = argv
  if (!command) {
    onFailure()
    return
  }
  const child = spawn(command, args, {
    cwd,
    detached: true,
    stdio: 'ignore',
    // No shell: the argv is executed verbatim, so a config value can never be
    // reinterpreted as a shell command line.
    shell: false,
  })
  child.on('error', (error) => {
    // The response is already flushed; surface the failure in the server log.
    console.error(`memon: file-access restart adapter failed: ${error.message}`)
    onFailure()
  })
  child.on('exit', (code, signal) => {
    if (code === 0) return
    console.error(
      `memon: file-access restart adapter exited without restarting the service (code=${code ?? 'null'} signal=${signal ?? 'null'})`,
    )
    onFailure()
  })
  child.unref()
}

/**
 * Schedule the machine-local restart adapter. The delay exists so the HTTP
 * response reaches the browser before the process is torn down; the caller
 * returns the outcome immediately and never awaits the child.
 */
export function scheduleFileAccessRestart(
  adapter: RestartAdapter,
  options: ScheduleRestartOptions,
): RestartOutcome {
  if (adapter.status === 'missing') {
    return {
      ok: false,
      code: 'RESTART_REQUIRED',
      message:
        'no restart adapter is configured on this machine; restart the service manually to activate the saved settings',
    }
  }
  if (adapter.status === 'invalid') {
    return { ok: false, code: 'RESTART_ADAPTER_INVALID', message: adapter.message }
  }

  const delayMs = options.delayMs ?? RESTART_SCHEDULE_DELAY_MS
  const state = restartState()
  if (state.scheduled) return { ok: true, code: 'RESTART_ALREADY_SCHEDULED', delayMs }
  state.scheduled = true

  const releaseSchedule = () => {
    state.scheduled = false
  }
  const spawnRestart =
    options.spawnImpl ?? ((argv, dir) => spawnDetachedRestart(argv, dir, releaseSchedule))
  const cwd = dirname(options.configPath)
  const timer = setTimeout(() => {
    try {
      spawnRestart(adapter.argv, cwd)
    } catch (error) {
      releaseSchedule()
      console.error(
        `memon: file-access restart adapter could not be spawned: ${(error as Error).message}`,
      )
    }
  }, delayMs)
  // Do not hold the event loop open purely to restart.
  timer.unref?.()

  return { ok: true, code: 'RESTART_SCHEDULED', delayMs }
}

// ---------------------------------------------------------------------------
// Metrics window
// ---------------------------------------------------------------------------

export type WindowParse = { ok: true; windowMs: number } | { ok: false; message: string }

/** Parse the optional `windowMs` query parameter for the metrics snapshot. */
export function parseMetricsWindow(raw: string | null): WindowParse {
  if (raw === null || raw === '') return { ok: true, windowMs: DEFAULT_METRICS_WINDOW_MS }
  const value = Number(raw)
  if (!Number.isInteger(value) || value < MIN_METRICS_WINDOW_MS || value > MAX_METRICS_WINDOW_MS) {
    return {
      ok: false,
      message: `windowMs must be an integer between ${MIN_METRICS_WINDOW_MS} and ${MAX_METRICS_WINDOW_MS}`,
    }
  }
  return { ok: true, windowMs: value }
}
