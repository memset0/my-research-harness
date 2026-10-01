// Request-scoped memo for one Backend request.
//
// The route pipeline opens a scope around every handler. Inside it the real
// path of a Project root is resolved at most once and shared by every
// containment check and Run path resolution of that request (concurrent
// awaits share the same promise). Nothing outlives the request; outside a
// scope (CLI-shaped callers, tests) every call resolves afresh.

import { AsyncLocalStorage } from 'node:async_hooks'
import { resolve } from 'node:path'
import { projectFs as fs } from '@memon/core'

interface RequestScope {
  realRoots: Map<string, Promise<string>>
}

const storage = new AsyncLocalStorage<RequestScope>()

/** Run `callback` inside a fresh request scope. */
export function withRequestScope<T>(callback: () => Promise<T>): Promise<T> {
  return storage.run({ realRoots: new Map() }, callback)
}

/**
 * The real path of a Project root, resolved once per request. A failure is
 * not memoized: the next caller in the same request tries again.
 */
export function realProjectRoot(root: string): Promise<string> {
  const lexical = resolve(root)
  const scope = storage.getStore()
  if (!scope) return fs.realpath(lexical)
  const known = scope.realRoots.get(lexical)
  if (known) return known
  const pending = fs.realpath(lexical)
  scope.realRoots.set(lexical, pending)
  pending.catch(() => {
    if (scope.realRoots.get(lexical) === pending) scope.realRoots.delete(lexical)
  })
  return pending
}
