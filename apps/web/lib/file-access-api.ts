// Client for the owner-only file-access settings surface (`/api/file-access`).
//
// Kept out of `lib/api.ts` because none of it is project-scoped and because the
// endpoint answers with `{error, code}` envelopes that callers need to branch
// on (revision conflict, validation issues, missing restart adapter) rather
// than a thrown message. Every read is deliberately a discriminated result.
//
// The metrics payload is passed through verbatim from
// `getFileOperationMetrics()` in @memon/core. We mirror its shape here instead
// of importing it, because this module ships to the browser and @memon/core
// pulls `fs` in transitively.

export interface FileAccessOptionsDto {
  concurrency: number
  heartbeatMs: number
  leaseMs: number
  fileMinMs: number
  fileMaxMs: number
  directoryMinMs: number
  directoryMaxMs: number
  maintenanceMinMs: number
  maintenanceMaxMs: number
  failureMinMs: number
  failureMaxMs: number
  backoffFactor: number
  wikiTtlMs: number
  defaultTtlMs: number
}

export const FILE_ACCESS_OPTION_KEYS = [
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
  'wikiTtlMs',
  'defaultTtlMs',
] as const satisfies ReadonlyArray<keyof FileAccessOptionsDto>

export interface FileOperationLatency {
  meanMs: number
  p95Ms: number
}

export interface FileOperationCounters {
  samples: number
  errors: number
  cacheHits: number
  coalesced: number
  readBytes: number
  queueWaitMs: FileOperationLatency
  executionMs: FileOperationLatency
}

export type FileOperationName = 'readFile' | 'readdir' | 'stat' | 'lstat' | 'realpath' | 'write'
export type FileOperationOrigin = 'human' | 'automatic'

export interface FileOperationSeries extends FileOperationCounters {
  storageGroup: string
  operation: FileOperationName
  origin: FileOperationOrigin
}

export interface FileOperationGroupState {
  storageGroup: string
  concurrency: number
  inFlight: number
  queued: number
  oldestWaitingAgeMs: number | null
}

export interface FileOperationMetrics {
  epoch: string
  generatedAt: string
  windowMs: number
  availableWindowsMs: number[]
  options: Omit<FileAccessOptionsDto, 'wikiTtlMs' | 'defaultTtlMs'>
  overall: FileOperationCounters
  byOrigin: Record<FileOperationOrigin, FileOperationCounters>
  byOperation: Record<FileOperationName, FileOperationCounters>
  series: FileOperationSeries[]
  groups: FileOperationGroupState[]
  inFlight: number
  queued: number
  oldestWaitingAgeMs: number | null
  cacheEntries: number
  cachedContentBytes: number
}

export interface FileAccessSettings {
  effective: FileAccessOptionsDto
  pending: FileAccessOptionsDto
  revision: string
  restartRequired: boolean
  restartAvailable: boolean
  cacheConfigured: boolean
  metrics: FileOperationMetrics | null
}

export interface FileAccessFailure {
  ok: false
  status: number
  code: string
  message: string
  /** Present on INVALID_SETTINGS: one entry per violated bound or relationship. */
  issues?: string[]
  /** Present on REVISION_CONFLICT: the values currently on disk. */
  revision?: string
  pending?: FileAccessOptionsDto
}

export type FileAccessResult = { ok: true; data: FileAccessSettings } | FileAccessFailure

export type FileAccessRestartCode =
  | 'RESTART_SCHEDULED'
  | 'RESTART_ALREADY_SCHEDULED'
  | 'RESTART_REQUIRED'
  | 'RESTART_ADAPTER_INVALID'

export interface FileAccessRestartResult {
  ok: boolean
  code: string
  message: string | null
  restartAvailable: boolean
  delayMs: number | null
  status: number
}

/** Windows the settings panel offers; the server accepts 1s..15min. */
export const FILE_ACCESS_METRIC_WINDOWS_MS = [60_000, 300_000, 900_000] as const
export const DEFAULT_FILE_ACCESS_METRIC_WINDOW_MS = 300_000

function settingsUrl(windowMs?: number): string {
  return windowMs === undefined
    ? '/api/file-access'
    : `/api/file-access?windowMs=${encodeURIComponent(String(windowMs))}`
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const FILE_ACCESS_ERROR_TEXT: Record<string, string> = {
  FORBIDDEN: 'File access settings are owner-only.',
  INVALID_WINDOW: 'That metrics window is out of range.',
  INVALID_BODY: 'The submitted settings payload was rejected.',
  INVALID_SETTINGS: 'These values are out of range or contradict each other.',
  REVISION_CONFLICT: 'The local config changed since this panel loaded.',
  CONFIG_SHAPE: 'The local config file access block is not a mapping; fix it by hand.',
  CONFIG_NOT_WRITABLE: 'The local config file is not writable by the service.',
  CONFIG_UNAVAILABLE: 'No local config file is selected, so there is nothing to save into.',
  SAVE_FAILED: 'Writing the local config failed; nothing was changed.',
}

function failure(status: number, body: unknown): FileAccessFailure {
  // Repo-standard envelope: `{ error: { code, message }, ...siblings }`.
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const envelope =
    record.error && typeof record.error === 'object'
      ? (record.error as Record<string, unknown>)
      : {}
  const code = typeof envelope.code === 'string' ? envelope.code : `HTTP_${status}`
  const message =
    typeof envelope.message === 'string' && envelope.message
      ? envelope.message
      : typeof record.error === 'string' && record.error
        ? record.error
        : (FILE_ACCESS_ERROR_TEXT[code] ?? `Request failed (${status})`)
  const issues = Array.isArray(record.issues)
    ? record.issues.filter((issue): issue is string => typeof issue === 'string')
    : []
  const result: FileAccessFailure = { ok: false, status, code, message }
  if (issues.length > 0) result.issues = issues
  if (typeof record.revision === 'string') result.revision = record.revision
  if (record.pending && typeof record.pending === 'object') {
    result.pending = record.pending as FileAccessOptionsDto
  }
  return result
}

async function settingsRequest(url: string, init?: RequestInit): Promise<FileAccessResult> {
  const response = await fetch(url, init)
  const body = await parseBody(response)
  if (!response.ok) return failure(response.status, body)
  if (!body || typeof body !== 'object') {
    return {
      ok: false,
      status: response.status,
      code: 'BAD_RESPONSE',
      message: 'Malformed response',
    }
  }
  return { ok: true, data: body as FileAccessSettings }
}

export async function fetchFileAccessSettings(windowMs?: number): Promise<FileAccessResult> {
  return settingsRequest(settingsUrl(windowMs))
}

export async function saveFileAccessSettings(input: {
  revision: string
  settings: FileAccessOptionsDto
  windowMs?: number
}): Promise<FileAccessResult> {
  return settingsRequest(settingsUrl(input.windowMs), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision: input.revision, settings: input.settings }),
  })
}

/**
 * Ask the machine-local restart adapter to activate pending settings. The
 * server flushes its answer before restarting, so `RESTART_SCHEDULED` means
 * "the connection is about to drop; reconnect and re-read effective values".
 */
export async function requestFileAccessRestart(): Promise<FileAccessRestartResult> {
  const response = await fetch('/api/file-access/restart', { method: 'POST' })
  const body = await parseBody(response)
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const message =
    typeof record.message === 'string'
      ? record.message
      : typeof record.error === 'string'
        ? record.error
        : null
  return {
    ok: record.ok === true,
    code: typeof record.code === 'string' ? record.code : `HTTP_${response.status}`,
    message,
    restartAvailable: record.restartAvailable === true,
    delayMs: typeof record.delayMs === 'number' ? record.delayMs : null,
    status: response.status,
  }
}
