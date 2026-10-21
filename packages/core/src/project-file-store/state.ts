// project-file-store/state — the in-memory shapes shared by the store, its
// scheduler. Types only: every value here is
// memory-only and lost on restart.

import type { FileOperationName, FileOperationOrigin, ObservedOperation } from './contract.js'
import type { Observation } from './observation.js'

export interface StoreEntry {
  key: string
  root: string
  group: StorageGroup
  operation: ObservedOperation
  path: string
  /** Fingerprint of the last successful observation; survives content eviction. */
  fingerprint: string | null
  /** Bumps only when the observed fingerprint changes. */
  observationVersion: number
  completedAtWall: number | null
  completedAtMono: number | null
  intervalMs: number
  dueAtMono: number
  failures: number
  /**
   * Current error CODE (never a message or path), or null when the last
   * attempt succeeded. `getProjectFileStatus` is serialized into a browser
   * response header, so it must never carry roots, paths or messages.
   */
  error: string | null
  /** Hard error to replay while no successful observation exists. */
  cachedError: NodeJS.ErrnoException | null
  attentionGeneration: number
  mutationGeneration: number
  lastAttentionAtWall: number
  /**
   * An explicit refresh (or a write) asked for re-verification and no
   * physical observation has answered it yet.
   */
  refreshRequested: boolean
}

export interface ScheduledTask {
  key: string
  entry: StoreEntry
  group: StorageGroup
  operation: FileOperationName
  human: boolean
  origin: FileOperationOrigin
  enqueuedAtMono: number
  startedAtMono: number | null
  attentionGeneration: number
  mutationGeneration: number
  state: 'queued' | 'running'
  runner: () => Promise<Observation>
  promise: Promise<Observation>
  resolve: (observation: Observation) => void
  reject: (error: unknown) => void
}

export interface StorageGroup {
  name: string
  active: number
  queue: ScheduledTask[]
  tasks: Map<string, ScheduledTask>
  /** Mutations waiting for a slot; granted before queued reads. */
  writeWaiters: (() => void)[]
}

export interface AttentionLease {
  root: string
  expiresAtWall: number
  keys: Set<string>
}
