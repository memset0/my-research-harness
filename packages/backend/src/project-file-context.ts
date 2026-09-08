import { getProjectFileContext, withProjectFileContext } from '@memon/core'

/**
 * Run collection and inventory work as background I/O without losing the
 * active Project's containment, storage, persistence, attention, or read-only
 * policy. Mutation contexts keep their forced-fresh `write` reason, and CLI
 * and other callers without an ambient file context stay direct.
 */
export function withAutomaticProjectFileContext<T>(callback: () => Promise<T>): Promise<T> {
  const context = getProjectFileContext()
  if (context === undefined || context.reason === 'write') return callback()
  return withProjectFileContext({ ...context, reason: 'automatic' }, callback)
}
