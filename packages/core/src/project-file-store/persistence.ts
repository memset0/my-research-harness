// project-file-store/persistence — the bridge between store entries and the
// opt-in persistent observation cache (`project-file-cache.ts`). Only
// completed successful observations of projects that opted in AND sit on a
// real SSHFS mount cross it; queues, waiters, leases, retries and metrics
// never do.

import { dirname } from '@memon/file-protocol/paths'
import {
  containingMount,
  type MountIdentity,
  SSHFS_FS_TYPE,
  sameMountIdentity,
} from '../mount-table.js'
import {
  getProjectFileCache,
  isPersistedOperation,
  type PersistedOperation,
  projectFileTtlMs,
} from '../project-file-cache.js'
import type { ProjectFileContext } from '../project-file-context.js'
import { agentAdapter, isAgentPath } from './agent-adapters.js'
import { monotonic } from './clock.js'
import { type Observation, observationFromPersisted, persistedPayloadOf } from './observation.js'
import type { PersistScope, StoreEntry } from './state.js'

/** What the bridge needs from the store that owns it. */
export interface PersistenceHooks {
  /** The shared OS-local mount-table snapshot. */
  mountTable(): Promise<MountIdentity[] | null>
  /** True when the store already holds a completed observation for the key. */
  has(key: string): boolean
  /** Install a restored observation as the entry's cached value. */
  adopt(entry: StoreEntry, observation: Observation): void
}

export class ObservationPersistence {
  /**
   * Persistent-cache scope per configured root, with the mount identity it
   * was resolved against. Re-resolved when that identity changes, so a
   * remapped root cannot keep writing into the previous namespace.
   */
  private readonly persistScopes = new Map<
    string,
    { mount: MountIdentity | null; scope: Promise<PersistScope | null> }
  >()
  /**
   * Orders every persistent-cache mutation this store issues, so a delete
   * caused by an invalidation can never be overtaken by an older write.
   */
  private persistTail: Promise<void> = Promise.resolve()

  constructor(private readonly hooks: PersistenceHooks) {}

  /**
   * Persistent scope for a context, or null when nothing may be persisted.
   *
   * Two conditions must both hold: the project opted in, and its configured
   * root actually sits on an SSHFS mount (the OS-local mount table decides —
   * never a path shape, and never a remote `realpath`). A local project is
   * therefore never written to the dump, and a valid restored answer never
   * waits on remote resolution.
   */
  async scope(context: ProjectFileContext): Promise<PersistScope | null> {
    if (context.persistentCache !== true) return null
    const cache = getProjectFileCache()
    if (cache === null) return null
    if (isAgentPath(context.root)) {
      const { adapter } = await agentAdapter(context.root)
      const namespaceId = await cache.namespaceId({
        root: context.root,
        sourceIdentity: adapter.sourceIdentity,
        authorityIdentity: adapter.authorityIdentity,
      })
      const scope = Promise.resolve({ cache, namespaceId, mount: null })
      this.persistScopes.set(context.root, { mount: null, scope })
      return scope
    }
    const table = await this.hooks.mountTable()
    if (table === null) return null
    const mount = containingMount(context.root, table)
    if (mount === undefined || mount.fsType !== SSHFS_FS_TYPE) return null

    const memo = this.persistScopes.get(context.root)
    if (memo !== undefined && memo.mount !== null && sameMountIdentity(memo.mount, mount)) {
      const scope = await memo.scope
      if (scope === null || scope.cache === cache) return scope
    }
    // A different mount identity (or reconfigured dump) is a different
    // namespace: previous storage observations stay unreachable.
    const resolving = cache
      .namespaceId({ root: context.root, mount })
      .then((namespaceId) => ({ cache, namespaceId, mount }))
      // Persistence is an optimisation: failure degrades to memory-only
      // behaviour instead of failing the project read.
      .catch(() => null)
    this.persistScopes.set(context.root, { mount, scope: resolving })
    return await resolving
  }

  /**
   * Adopt one completed answer from the snapshot-backed memory LRU. It
   * carries the original observation time, so freshness stays honest across
   * restart instead of pretending the process just looked.
   */
  async restore(context: ProjectFileContext, entry: StoreEntry): Promise<void> {
    if (entry.persistLoad !== null) {
      await entry.persistLoad
      return
    }
    const operation = entry.operation
    if (!isPersistedOperation(operation)) {
      entry.persistLoaded = true
      return
    }
    const generation = entry.mutationGeneration
    const load = this.load(context, entry, operation, generation)
      .catch(() => undefined)
      .then(() => {
        if (entry.persistLoad !== load) return
        entry.persistLoaded = true
        entry.persistLoad = null
      })
    entry.persistLoad = load
    await load
  }

  private async load(
    context: ProjectFileContext,
    entry: StoreEntry,
    operation: PersistedOperation,
    generation: number,
  ): Promise<void> {
    const scope = await this.scope(context)
    if (entry.mutationGeneration !== generation) return
    entry.persist = scope
    if (scope === null) return
    await this.persistTail
    const stored = await scope.cache.load(scope.namespaceId, operation, entry.path)
    if (stored === null) return
    const observation = observationFromPersisted(stored.payload, entry.path)
    if (observation.fingerprint !== stored.fingerprint) {
      // The payload does not match its own fingerprint: an unusable row is
      // dropped rather than served as a half-understood answer.
      this.enqueue(() => scope.cache.delete(scope.namespaceId, operation, entry.path))
      return
    }
    // An invalidation or a physical observation that landed while this row was
    // being read wins: a restored row must never resurrect superseded state.
    if (entry.mutationGeneration !== generation || this.hooks.has(entry.key)) return

    const ttl = projectFileTtlMs(entry.root, entry.path)
    const age = Math.max(0, Date.now() - stored.observedAtWall)
    const now = monotonic()
    this.hooks.adopt(entry, observation)
    entry.fingerprint = observation.fingerprint
    entry.observationVersion += 1
    entry.completedAtWall = stored.observedAtWall
    entry.completedAtMono = now - age
    entry.intervalMs = ttl
    // Inside the lifetime the row answers with no physical I/O at all; past
    // it — or when an explicit refresh is still waiting for a real look — the
    // row still answers immediately and one background verification is
    // scheduled, which is what keeps a hung mount from blocking a page.
    entry.dueAtMono = entry.refreshRequested || age >= ttl ? now : now + (ttl - age)
  }

  /**
   * Store a completed successful observation. Only the operations whose data
   * was actually observed are persisted; nothing about the queue, the waiters,
   * the leases or the retry state ever reaches the dump.
   */
  persist(entry: StoreEntry, observation: Observation): void {
    const scope = entry.persist
    if (scope === null) return
    const operation = entry.operation
    if (!isPersistedOperation(operation)) return
    const payload = persistedPayloadOf(observation)
    if (payload === null) return
    const observedAtWall = entry.completedAtWall ?? Date.now()
    this.enqueue(() =>
      scope.cache.put(scope.namespaceId, operation, entry.path, {
        payload,
        fingerprint: observation.fingerprint,
        observedAtWall,
      }),
    )
  }

  /**
   * Order one persistent-cache mutation behind every mutation issued before
   * it, so a delete caused by an invalidation cannot be overtaken by an older
   * observation's write.
   */
  private enqueue(work: () => Promise<void>): void {
    this.persistTail = this.persistTail.then(work, work).then(
      () => undefined,
      () => undefined,
    )
  }

  /**
   * Forget every persisted observation of one path (and of its parent
   * listing): the content is known to have changed, so leaving a row would let
   * a later process serve a value that was already superseded here.
   */
  forgetPath(root: string, absolutePath: string): void {
    const memo = this.persistScopes.get(root)
    if (memo === undefined) return
    const parent = dirname(absolutePath)
    this.enqueue(async () => {
      const scope = await memo.scope
      if (scope === null) return
      await scope.cache.deletePath(scope.namespaceId, absolutePath)
      if (parent !== absolutePath) {
        await scope.cache.delete(scope.namespaceId, 'readdir', parent)
      }
    })
  }
}
