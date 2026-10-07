import 'server-only'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type { ProjectConfig } from '@memon/core'

interface RequestScope {
  request: Request
  attentionId: string
  projects: Map<string, ProjectConfig>
}
const KEY = Symbol.for('memon.unqualified-request-context.v1')
const carrier = globalThis as unknown as { [KEY]?: AsyncLocalStorage<RequestScope> }
carrier[KEY] ??= new AsyncLocalStorage<RequestScope>()
const contexts = carrier[KEY]
export function standaloneRequestContext() {
  return contexts.getStore()
}
export function runStandaloneRequest<T>(
  request: Request,
  work: (scope: RequestScope) => Promise<T>,
) {
  const supplied = request.headers.get('x-memon-attention')
  const scope = {
    request,
    attentionId: supplied && /^[A-Za-z0-9_-]{1,64}$/.test(supplied) ? supplied : randomUUID(),
    projects: new Map<string, ProjectConfig>(),
  }
  return contexts.run(scope, () => work(scope))
}
