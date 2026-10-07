// project-file-store/runtime — the process-global store and the public
// functions that operate on it.

import { FileAccessError } from '@memon/file-protocol'
import { resolve } from '@memon/file-protocol/paths'
import {
  getProjectFileContext as currentProjectFileContext,
  type ProjectFileContext,
} from '../project-file-context.js'
import type { FileAccessOptions } from '../types.js'
import { agentSourceIdentity } from './agent-adapters.js'
import type { FileOperationMetrics, ProjectFileStatus } from './contract.js'
import { ProjectFileStore } from './store.js'

// ---------------------------------------------------------------------------
// Process-global singleton (survives duplicated Next.js server bundles)
// ---------------------------------------------------------------------------

const STORE_SYMBOL = Symbol.for('memon.project-file-store.v2')

interface StoreCarrier {
  [STORE_SYMBOL]?: ProjectFileStore
}

export function getStore(): ProjectFileStore {
  const carrier = globalThis as unknown as StoreCarrier
  let store = carrier[STORE_SYMBOL]
  if (store === undefined) {
    store = new ProjectFileStore()
    carrier[STORE_SYMBOL] = store
  }
  return store
}

// ---------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------

export function withProjectFileContext<T>(context: ProjectFileContext, callback: () => T): T {
  const store = getStore()
  const normalized: ProjectFileContext = { ...context, root: resolve(context.root) }
  const sourceIdentity = agentSourceIdentity(normalized.root)
  if (normalized.sourceIdentity && sourceIdentity && normalized.sourceIdentity !== sourceIdentity)
    throw new FileAccessError('SOURCE_UNAVAILABLE')
  if (sourceIdentity) normalized.sourceIdentity = sourceIdentity
  store.noteSource(normalized.root, normalized.sourceIdentity)
  store.noteStorage(
    normalized.root,
    normalized.cachePolicy === 'none'
      ? 'local'
      : normalized.cachePolicy
        ? 'sshfs'
        : normalized.storage,
  )
  return store.contextStorage.run(normalized, callback)
}

/** The active context, or undefined when running outside one (CLI, scripts). */
export function getProjectFileContext(): ProjectFileContext | undefined {
  return currentProjectFileContext()
}

export function configureProjectFileStore(options: Partial<FileAccessOptions>): void {
  getStore().configure(options)
}

export function getProjectFileAccessOptions(): FileAccessOptions {
  return getStore().effectiveOptions()
}

export function getProjectFileStatus(root: string, attentionId?: string): ProjectFileStatus {
  return getStore().status(root, attentionId)
}

export function getFileOperationMetrics(windowMs?: number): FileOperationMetrics {
  return getStore().metricsSnapshot(windowMs)
}

export function invalidateProjectFile(root: string, path?: string): void {
  getStore().invalidate(root, path)
}

export function getProjectFileSourceNamespace(root: string): string {
  return getStore().sourceNamespace(resolve(root))
}
