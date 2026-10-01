// project-file-store/state — the in-memory shapes shared by the store, its
// scheduler and its persistence bridge. Types only: every value here is
// memory-only and lost on restart.

import type { MountIdentity } from '../mount-table.js'
import type { ProjectFileCache } from '../project-file-cache.js'
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
   * physical observation has answered it yet. A row restored from the
   * persistent cache is not that answer, so it must not cancel the request.
   */
  refreshRequested: boolean
  /**
   * Persistent-cache scope for this key, or null when this project is not
   * persisted. Resolved once, when the entry is first demanded.
   */
  persist: PersistScope | null
  /**
   * True once the snapshot-backed memory cache has been consulted (or has
   * deliberately been made irrelevant by an invalidation). Eviction may
   * permit another lookup; invalidation must not resurrect an old answer.
   */
  persistLoaded: boolean
  persistLoad: Promise<void> | null
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

/**
 * Everything needed to reach a project's snapshot-backed observations: the
 * memory cache and stable namespace for configured root plus mount identity.
 * A root remapped to different storage resolves a different namespace, so
 * observations of the previous storage can never be reused.
 */
export interface PersistScope {
  cache: ProjectFileCache
  namespaceId: string
  mount: MountIdentity
}
