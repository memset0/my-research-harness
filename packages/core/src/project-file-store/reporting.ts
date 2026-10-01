// project-file-store/reporting — the freshness status of a root (or of one
// page's attention scope) and the operator metrics snapshot. Both are pure
// reads of in-memory store state: no project I/O, no telemetry persistence.

import { createHash } from 'node:crypto'
import { formatIsoLocal } from '../time.js'
import type { FileAccessOptions } from '../types.js'
import { monotonic } from './clock.js'
import type {
  FileOperationGroupState,
  FileOperationMetrics,
  ProjectFileStatus,
} from './contract.js'
import {
  METRIC_BUCKET_COUNT,
  METRIC_BUCKET_MS,
  METRIC_WINDOWS_MS,
  type MetricsRegistry,
  round3,
} from './metrics.js'
import type { AttentionLease, StorageGroup, StoreEntry } from './state.js'

/** The store state freshness reporting reads. */
export interface FreshnessView {
  epoch: string
  directRoots: ReadonlySet<string>
  attentions: ReadonlyMap<string, AttentionLease>
  entries: ReadonlyMap<string, StoreEntry>
  groups: ReadonlyMap<string, StorageGroup>
}

/**
 * Freshness of `normalizedRoot`, scoped to one page's attention lease when
 * `attentionId` names a live lease. `now` is the wall clock the caller already
 * swept expired leases with.
 */
export function freshnessStatus(
  view: FreshnessView,
  normalizedRoot: string,
  attentionId: string | undefined,
  now: number,
): ProjectFileStatus {
  // A direct root has no queue, no lease and no observation vector: every
  // read already came from the filesystem at request time.
  if (view.directRoots.has(normalizedRoot)) {
    return {
      epoch: view.epoch,
      oldestVerifiedAt: null,
      incomplete: false,
      queued: 0,
      checking: 0,
      error: null,
      version: 'direct',
      direct: true,
    }
  }

  let scoped: StoreEntry[] | null = null
  if (attentionId !== undefined) {
    const lease = view.attentions.get(`${normalizedRoot}\u0000${attentionId}`)
    if (lease !== undefined && lease.expiresAtWall >= now) {
      scoped = []
      for (const key of lease.keys) {
        const entry = view.entries.get(key)
        if (entry !== undefined && entry.root === normalizedRoot) scoped.push(entry)
      }
    }
  }
  const entries =
    scoped ?? [...view.entries.values()].filter((entry) => entry.root === normalizedRoot)

  let oldestVerifiedAt: number | null = null
  // Nothing observed yet for this scope is an honestly incomplete freshness
  // claim, not "verified with no dependencies".
  let incomplete = entries.length === 0
  let error: string | null = null
  const version = createHash('sha1')
  version.update(view.epoch)
  for (const entry of entries.slice().sort((a, b) => a.key.localeCompare(b.key))) {
    if (entry.completedAtWall === null) {
      incomplete = true
    } else if (oldestVerifiedAt === null || entry.completedAtWall < oldestVerifiedAt) {
      oldestVerifiedAt = entry.completedAtWall
    }
    if (error === null && entry.error !== null) error = entry.error
    version.update(`${entry.key}:${entry.observationVersion}\u0000`)
  }

  let queued = 0
  let checking = 0
  const scopedKeys = scoped === null ? null : new Set(scoped.map((entry) => entry.key))
  for (const group of view.groups.values()) {
    for (const task of group.tasks.values()) {
      if (task.entry.root !== normalizedRoot) continue
      if (scopedKeys !== null && !scopedKeys.has(task.key)) continue
      if (task.state === 'running') checking += 1
      else queued += 1
    }
  }

  return {
    epoch: view.epoch,
    oldestVerifiedAt,
    incomplete,
    queued,
    checking,
    error,
    version: version.digest('hex').slice(0, 32),
  }
}

/** The store state the metrics snapshot reads. */
export interface MetricsView {
  epoch: string
  options: FileAccessOptions
  metrics: MetricsRegistry
  groups: ReadonlyMap<string, StorageGroup>
  cacheEntries(): number
  cachedContentBytes(): number
}

export function metricsSnapshot(view: MetricsView, windowMs?: number): FileOperationMetrics {
  const requested = windowMs ?? 300_000
  const effectiveWindow = Math.min(
    Math.max(requested, METRIC_BUCKET_MS),
    METRIC_BUCKET_MS * METRIC_BUCKET_COUNT,
  )
  const rolled = view.metrics.snapshot(effectiveWindow)
  const now = monotonic()

  let inFlight = 0
  let queued = 0
  let oldestWaitingAgeMs: number | null = null
  const groups: FileOperationGroupState[] = []
  for (const group of view.groups.values()) {
    let groupQueued = group.writeWaiters.length
    let groupOldest: number | null = null
    for (const task of group.queue) {
      groupQueued += 1
      const age = now - task.enqueuedAtMono
      if (groupOldest === null || age > groupOldest) groupOldest = age
    }
    inFlight += group.active
    queued += groupQueued
    if (groupOldest !== null && (oldestWaitingAgeMs === null || groupOldest > oldestWaitingAgeMs)) {
      oldestWaitingAgeMs = groupOldest
    }
    groups.push({
      storageGroup: group.name,
      concurrency: view.options.concurrency,
      inFlight: group.active,
      queued: groupQueued,
      oldestWaitingAgeMs: groupOldest === null ? null : round3(groupOldest),
    })
  }
  groups.sort((a, b) => a.storageGroup.localeCompare(b.storageGroup))

  return {
    epoch: view.epoch,
    generatedAt: formatIsoLocal(new Date()),
    windowMs: effectiveWindow,
    availableWindowsMs: [...METRIC_WINDOWS_MS],
    options: { ...view.options },
    overall: rolled.overall,
    byOrigin: rolled.byOrigin,
    byOperation: rolled.byOperation,
    series: rolled.series,
    groups,
    inFlight,
    queued,
    oldestWaitingAgeMs: oldestWaitingAgeMs === null ? null : round3(oldestWaitingAgeMs),
    cacheEntries: view.cacheEntries(),
    cachedContentBytes: view.cachedContentBytes(),
  }
}
