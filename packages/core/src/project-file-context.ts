// The ambient Project file context and the project-file change signal.
//
// A leaf module (no internal imports) shared by the Project file store and
// the git command cache, so neither has to import the other: the store owns
// the context lifecycle and reports changes here; the git cache reads the
// context and listens for changes. Both carriers live on `globalThis` so a
// duplicated server bundle still shares one context and one listener set.

import { AsyncLocalStorage } from 'node:async_hooks'

export const FILE_OPERATION_REASONS = [
  'open',
  'focus',
  'manual',
  'heartbeat',
  'automatic',
  'write',
] as const

export type FileOperationReason = (typeof FILE_OPERATION_REASONS)[number]

export interface ProjectFileContext {
  /** Absolute project root. Identity of every cache key created in the context. */
  root: string
  /**
   * Physical storage class of the Project. `'local'` performs every operation
   * directly on the native filesystem inside this context: contained and
   * read-only-enforced, but never queued, coalesced, cached, leased, backed
   * off, counted or run in an I/O worker. `undefined` means `'sshfs'` — the
   * scheduled path — so a caller that predates the switch keeps its
   * behaviour. (The *config* default is the opposite: an unconfigured
   * Project is local.)
   */
  storage?: 'local' | 'sshfs'
  /** Physical storage bucket sharing one concurrency limit. Defaults to `'default'`. */
  storageGroup?: string
  /** Why the read happens; human reasons reset backoff and take priority. */
  reason?: FileOperationReason
  /** Opaque tab/page id used for attention leases and freshness scoping. */
  attentionId?: string
  /** When true, every mutating facade method fails with EROFS. */
  readOnly?: boolean
  /**
   * Opt in to persisting this project's observations across restarts. Honoured
   * only when the root also resolves to a real SSHFS mount: a local project is
   * never written to the cache database.
   */
  persistentCache?: boolean
}

const CONTEXT_SYMBOL = Symbol.for('memon.project-file-context.v1')
const LISTENERS_SYMBOL = Symbol.for('memon.project-file-change-listeners.v1')

interface ContextCarrier {
  [CONTEXT_SYMBOL]?: AsyncLocalStorage<ProjectFileContext>
  [LISTENERS_SYMBOL]?: Set<ProjectFilesChangedListener>
}

/** The process-wide async context carrying the active `ProjectFileContext`. */
export function projectFileContextStorage(): AsyncLocalStorage<ProjectFileContext> {
  const carrier = globalThis as unknown as ContextCarrier
  carrier[CONTEXT_SYMBOL] ??= new AsyncLocalStorage<ProjectFileContext>()
  return carrier[CONTEXT_SYMBOL]
}

/** The active context, or undefined when running outside one (CLI, scripts). */
export function getProjectFileContext(): ProjectFileContext | undefined {
  return projectFileContextStorage().getStore()
}

/** Called with the resolved project root whose files changed. */
export type ProjectFilesChangedListener = (root: string) => void

function listeners(): Set<ProjectFilesChangedListener> {
  const carrier = globalThis as unknown as ContextCarrier
  carrier[LISTENERS_SYMBOL] ??= new Set()
  return carrier[LISTENERS_SYMBOL]
}

/** Subscribe to project file changes; returns the unsubscribe function. */
export function onProjectFilesChanged(listener: ProjectFilesChangedListener): () => void {
  listeners().add(listener)
  return () => {
    listeners().delete(listener)
  }
}

/** Report that files under `root` changed. Listener failures never propagate. */
export function notifyProjectFilesChanged(root: string): void {
  for (const listener of listeners()) {
    try {
      listener(root)
    } catch {
      /* a cache listener must never fail the file operation */
    }
  }
}
