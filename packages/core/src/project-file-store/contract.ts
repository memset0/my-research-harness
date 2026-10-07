// project-file-store/contract — public reasons, default options, and the status and
// metric shapes the Project file store reports.

import { FILE_OPERATION_REASONS, type FileOperationReason } from '../project-file-context.js'
import type { FileAccessOptions } from '../types.js'

/** Reasons that represent a person waiting on the answer right now. */
const HUMAN_REASON: Record<FileOperationReason, boolean> = {
  open: true,
  focus: true,
  manual: true,
  heartbeat: false,
  automatic: false,
  write: true,
}

/**
 * Reasons that discard the current freshness lifetime and re-verify now.
 *
 * Opening or focusing a page is deliberately NOT one of them: those are the
 * navigations a person performs constantly, and forcing physical I/O for each
 * one is what made a remote project feel unusable. They still count as human
 * demand (queue priority, attention lease) and they still serve the cached
 * observation. An explicit refresh (`manual`) and a write are the events that
 * mean "look again now".
 */
export const RESET_REASON: Record<FileOperationReason, boolean> = {
  open: false,
  focus: false,
  manual: true,
  heartbeat: false,
  automatic: false,
  write: true,
}

/** Narrow an `X-Memon-Reason` header value; unknown values become undefined. */
export function parseFileOperationReason(
  raw: string | null | undefined,
): FileOperationReason | undefined {
  if (raw === null || raw === undefined) return undefined
  const value = raw.trim().toLowerCase()
  return (FILE_OPERATION_REASONS as readonly string[]).includes(value)
    ? (value as FileOperationReason)
    : undefined
}

export function isHumanFileOperationReason(reason: FileOperationReason | undefined): boolean {
  return reason !== undefined && HUMAN_REASON[reason]
}

export const DEFAULT_FILE_ACCESS_OPTIONS: FileAccessOptions = {
  operationsPerSecond: 0,
  operationBurst: 10,
  bytesPerSecond: 0,
  byteBurst: 64 * 1024 * 1024,
  maxReadBytes: 16 * 1024 * 1024,
  backgroundShare: 0.5,
  concurrency: 10,
  heartbeatMs: 30_000,
  leaseMs: 90_000,
  fileMinMs: 5_000,
  fileMaxMs: 30_000,
  directoryMinMs: 15_000,
  directoryMaxMs: 60_000,
  maintenanceMinMs: 300_000,
  maintenanceMaxMs: 900_000,
  failureMinMs: 15_000,
  failureMaxMs: 300_000,
  backoffFactor: 2,
}

export type FileOperationName = 'readFile' | 'readdir' | 'stat' | 'lstat' | 'realpath' | 'write'
export type FileOperationOrigin = 'human' | 'automatic'

/** Operations that own a cache entry (`write` is scheduled but never cached). */
export type ObservedOperation = Exclude<FileOperationName, 'write'>

export interface ProjectFileStatus {
  /** Process instance token; invalidates every client version assumption. */
  epoch: string
  /** Wall-clock ms of the oldest successful observation in scope, null when none. */
  oldestVerifiedAt: number | null
  /** True when some dependency in scope has no successful observation yet. */
  incomplete: boolean
  queued: number
  checking: number
  /**
   * Errno-style CODE only (for example `EACCES`, `ENXIO`, `EIO`), never a
   * message, root or path: this object is serialized into a browser response
   * header.
   */
  error: string | null
  /** Dependency observation vector token — NOT a semantic body hash. */
  version: string
  /**
   * True when this root is read directly (`storage: local`): nothing is
   * scheduled or cached, so there is no freshness to report and `version`
   * is the constant `'direct'`.
   */
  direct?: boolean
}

export interface FileOperationLatency {
  meanMs: number
  p95Ms: number
}

export interface FileOperationCounters {
  operationBudgetDeferrals?: number
  byteBudgetDeferrals?: number
  validationChecks?: number
  transportBodyBytes?: number
  /** Physical operations completed in the window (a shared op counts once). */
  samples: number
  errors: number
  cacheHits: number
  /** Extra callers that joined an existing task instead of adding I/O. */
  coalesced: number
  /** Application bytes returned by physical reads. */
  readBytes: number
  queueWaitMs: FileOperationLatency
  executionMs: FileOperationLatency
}

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
  /** ISO8601 with timezone offset. */
  generatedAt: string
  windowMs: number
  availableWindowsMs: number[]
  options: FileAccessOptions
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
