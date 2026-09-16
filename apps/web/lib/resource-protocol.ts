// Browser half of the foreground resource protocol.
//
// Every JSON GET the dashboard makes carries an attention id and a reason so
// the server-side file store can tell human foreground demand apart from
// automatic upkeep. Responses carry a semantic resource version, the file
// status of the dependencies that produced them, and a store epoch:
//
//   request   X-Memon-Attention      opaque per-tab id
//             X-Memon-Reason         open | focus | manual | heartbeat | automatic | write
//             X-Memon-Known-Version  semantic version this tab already holds
//   response  X-Memon-Resource-Version  semantic hash of the body
//             X-Memon-File-Status       JSON getProjectFileStatus() for the request
//             X-Memon-Epoch             store epoch; a new epoch voids known versions
//
// A `304` means "your known version is still current": we hand back the exact
// object we returned last time, so TanStack Query sees referential equality and
// nothing re-renders. Recorded statuses feed the footer's page freshness.
//
// This module is imported from `lib/api.ts`, which also runs during SSR, so it
// must stay isomorphic: every browser API is behind a `typeof` guard.

import { isCollectionResourcePath } from './resource-policy'

export type ResourceReason = 'open' | 'focus' | 'manual' | 'heartbeat' | 'automatic' | 'write'

/** `getProjectFileStatus()` as serialized into `X-Memon-File-Status`. */
export interface ProjectFileStatus {
  epoch: string
  /** Epoch ms of the oldest successful observation, null when nothing is verified yet. */
  oldestVerifiedAt: number | null
  incomplete: boolean
  queued: number
  checking: number
  error: string | null
  /**
   * The project is read directly (`storage: local`): nothing is queued, cached
   * or leased, so the queue/check/age fields carry no information.
   */
  direct?: boolean
  /** Dependency observation vector, not a semantic body hash. */
  version: string
}

/** Aggregate freshness of every resource the current page has read. */
export interface PageResourceStatus {
  scope: string
  oldestVerifiedAt: number | null
  incomplete: boolean
  queued: number
  checking: number
  error: string | null
  epoch: string | null
  /** How many distinct resources contributed to this aggregate. */
  resources: number
  /** Every contributing dependency was read directly from local disk. */
  direct: boolean
}

export const ATTENTION_HEADER = 'X-Memon-Attention'
export const REASON_HEADER = 'X-Memon-Reason'
export const KNOWN_VERSION_HEADER = 'X-Memon-Known-Version'
export const RESOURCE_VERSION_HEADER = 'X-Memon-Resource-Version'
export const FILE_STATUS_HEADER = 'X-Memon-File-Status'
export const EPOCH_HEADER = 'X-Memon-Epoch'

/** Bodies retained for conditional requests. Bounded; oldest entry evicted first. */
const VERSION_CACHE_LIMIT = 256

interface CachedResource {
  version: string
  body: unknown
}

const versionCache = new Map<string, CachedResource>()

// ---------------------------------------------------------------- attention

const ATTENTION_STORAGE_KEY = 'memon:attention-id'

let attentionId: string | null = null

function randomId(): string {
  const cryptoRef = typeof globalThis === 'undefined' ? undefined : globalThis.crypto
  if (cryptoRef?.randomUUID) return cryptoRef.randomUUID()
  return `a${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

/**
 * Stable per-tab attention id. Kept in sessionStorage so a reload keeps the
 * same interest instead of orphaning a lease, while a second tab gets its own.
 */
export function resourceAttentionId(): string {
  if (attentionId) return attentionId
  if (typeof window === 'undefined') return 'ssr'
  try {
    const stored = window.sessionStorage.getItem(ATTENTION_STORAGE_KEY)
    attentionId = stored ?? randomId()
    if (!stored) window.sessionStorage.setItem(ATTENTION_STORAGE_KEY, attentionId)
  } catch {
    // Private-mode storage denial: an in-memory id is still correct for this tab.
    attentionId = randomId()
  }
  return attentionId
}

// ------------------------------------------------------------------- reason

let explicitReason: ResourceReason | null = null
let openWindowUntil = 0

/**
 * Scope every request started synchronously inside `run` to one reason. The
 * heartbeat coordinator wraps its refetch batches with this.
 */
export function withResourceReason<T>(reason: ResourceReason, run: () => T): T {
  const previous = explicitReason
  explicitReason = reason
  try {
    return run()
  } finally {
    explicitReason = previous
  }
}

/**
 * Treat requests started in the next `ttlMs` as human page-open demand. Mount
 * fetches after a navigation land here rather than inside a reason scope.
 */
export function markResourceOpen(ttlMs: number): void {
  openWindowUntil = Date.now() + ttlMs
}

export function currentResourceReason(): ResourceReason {
  if (explicitReason) return explicitReason
  return Date.now() < openWindowUntil ? 'open' : 'automatic'
}

// ------------------------------------------------------------ status store

const EMPTY_STATUS: PageResourceStatus = {
  scope: 'initial',
  oldestVerifiedAt: null,
  incomplete: false,
  queued: 0,
  checking: 0,
  error: null,
  epoch: null,
  resources: 0,
  direct: false,
}

let scope = 'initial'
let snapshot: PageResourceStatus = EMPTY_STATUS
const statuses = new Map<string, ProjectFileStatus>()
const statusListeners = new Set<() => void>()
let changedResources = 0

function recompute(): void {
  let oldestVerifiedAt: number | null = null
  let incomplete = false
  let queued = 0
  let checking = 0
  let error: string | null = null
  let epoch: string | null = null
  // Vacuously true for an empty page, narrowed by the first scheduled status.
  let direct = true
  for (const status of statuses.values()) {
    if (status.direct === true) {
      // A direct read has no observation vector, no queue and no lease: it
      // carries no age to age out and must not make the page look partial.
      if (!error && status.error) error = status.error
      epoch = status.epoch
      continue
    }
    direct = false
    if (status.oldestVerifiedAt === null) incomplete = true
    else if (oldestVerifiedAt === null || status.oldestVerifiedAt < oldestVerifiedAt) {
      oldestVerifiedAt = status.oldestVerifiedAt
    }
    if (status.incomplete) incomplete = true
    // Every status describes the same attention scope, so the counts overlap:
    // report the largest observation instead of a summed-up fiction.
    if (status.queued > queued) queued = status.queued
    if (status.checking > checking) checking = status.checking
    if (!error && status.error) error = status.error
    epoch = status.epoch
  }
  snapshot = {
    scope,
    oldestVerifiedAt,
    incomplete,
    queued,
    checking,
    error,
    epoch,
    resources: statuses.size,
    direct: statuses.size > 0 && direct,
  }
  for (const listener of statusListeners) listener()
}

/** Start a new page generation; previous pages' dependencies stop counting. */
export function resetResourceScope(next: string): void {
  if (next === scope) return
  scope = next
  attentionId = randomId()
  changedResources = 0
  statuses.clear()
  recompute()
}

export function subscribeResourceStatus(listener: () => void): () => void {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

export function getResourceStatusSnapshot(): PageResourceStatus {
  return snapshot
}

/** Server render has observed nothing yet; a constant keeps hydration stable. */
export function getServerResourceStatusSnapshot(): PageResourceStatus {
  return EMPTY_STATUS
}

/**
 * Number of resources whose semantic version changed since the last call.
 * Initial loads never count — only a real replacement of already-shown content.
 */
export function consumeResourceChanges(): number {
  const changed = changedResources
  changedResources = 0
  return changed
}

/** Test seam: drop caches, statuses and attention identity. */
export function __resetResourceProtocolForTests(): void {
  versionCache.clear()
  statuses.clear()
  attentionId = null
  explicitReason = null
  openWindowUntil = 0
  changedResources = 0
  scope = 'initial'
  snapshot = EMPTY_STATUS
}

// ---------------------------------------------------------------- requests

export interface ResourceRequest {
  url: string
  reason: ResourceReason
  /** GETs participate in version caching; other methods only carry protocol metadata. */
  cacheable: boolean
  /** A known version was offered, so the server may answer 304. */
  conditional: boolean
  headers: Record<string, string>
}

/**
 * Build the protocol headers for one request. Collection reads are always
 * automatic background work, regardless of an enclosing open/manual/focus
 * scope. `allowConditional` is false on the retry we make when the server
 * answered 304 but our body cache had been evicted.
 */
export function beginResourceRequest(
  url: string,
  init?: RequestInit,
  allowConditional = true,
): ResourceRequest {
  if (typeof window !== 'undefined') {
    resetResourceScope(window.location.pathname + window.location.search)
  }
  const method = (init?.method ?? 'GET').toUpperCase()
  const cacheable = method === 'GET'
  const readable = cacheable || method === 'HEAD'
  const pathname = readable ? new URL(url, 'http://memon.local').pathname : ''
  const reason: ResourceReason = !readable
    ? 'write'
    : isCollectionResourcePath(pathname)
      ? 'automatic'
      : currentResourceReason()
  const headers: Record<string, string> = {
    [ATTENTION_HEADER]: resourceAttentionId(),
    [REASON_HEADER]: reason,
  }
  const cached = cacheable && allowConditional ? versionCache.get(url) : undefined
  if (cached) headers[KNOWN_VERSION_HEADER] = cached.version
  return { url, reason, cacheable, conditional: cached !== undefined, headers }
}

function readStatusHeader(response: Response): ProjectFileStatus | null {
  const raw = response.headers.get(FILE_STATUS_HEADER)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<ProjectFileStatus>
    const oldest = parsed.oldestVerifiedAt
    return {
      epoch: typeof parsed.epoch === 'string' ? parsed.epoch : '',
      oldestVerifiedAt: typeof oldest === 'number' && Number.isFinite(oldest) ? oldest : null,
      incomplete: parsed.incomplete === true,
      queued: typeof parsed.queued === 'number' ? parsed.queued : 0,
      checking: typeof parsed.checking === 'number' ? parsed.checking : 0,
      error: typeof parsed.error === 'string' && parsed.error ? parsed.error : null,
      direct: parsed.direct === true,
      version: typeof parsed.version === 'string' ? parsed.version : '',
    }
  } catch {
    return null
  }
}

let knownEpoch: string | null = null

function applyEpoch(response: Response): void {
  const epoch = response.headers.get(EPOCH_HEADER)
  if (!epoch) return
  if (knownEpoch !== null && knownEpoch !== epoch) {
    // The store restarted: cached semantic versions mean nothing to it now.
    versionCache.clear()
    statuses.clear()
  }
  knownEpoch = epoch
}

function rememberStatus(request: ResourceRequest, response: Response): void {
  if (request.headers[ATTENTION_HEADER] !== resourceAttentionId()) return
  const status = readStatusHeader(response)
  if (!status) return
  statuses.set(request.url, status)
  recompute()
}

/**
 * Record a successful response. Returns the body unchanged so callers can
 * `return recordResourceResponse(...)` inline.
 */
export function recordResourceResponse(
  request: ResourceRequest,
  response: Response,
  body: unknown,
): unknown {
  applyEpoch(response)
  rememberStatus(request, response)
  const version = response.headers.get(RESOURCE_VERSION_HEADER)
  if (!version || !request.cacheable) return body
  const previous = versionCache.get(request.url)
  if (previous && previous.version !== version && request.headers[ATTENTION_HEADER] === resourceAttentionId()) changedResources += 1
  versionCache.delete(request.url)
  versionCache.set(request.url, { version, body })
  if (versionCache.size > VERSION_CACHE_LIMIT) {
    const oldest = versionCache.keys().next()
    if (!oldest.done) versionCache.delete(oldest.value)
  }
  return body
}

/**
 * Resolve a 304. Returns `{ hit: false }` when our body cache lost the entry,
 * in which case the caller must retry unconditionally.
 */
export function resolveNotModified(
  request: ResourceRequest,
  response: Response,
): { hit: true; body: unknown } | { hit: false } {
  applyEpoch(response)
  rememberStatus(request, response)
  const cached = versionCache.get(request.url)
  if (!cached) return { hit: false }
  // Refresh recency so a page's live resources are the last ones evicted.
  versionCache.delete(request.url)
  versionCache.set(request.url, cached)
  return { hit: true, body: cached.body }
}
