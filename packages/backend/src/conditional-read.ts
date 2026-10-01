// Conditional list reads: an `ETag` derived from what a response was built
// from, and a `304` that only re-validates those observations.
//
// A conditional route computes its body inside a dependency recorder; every
// summary-index observation made on the way (files, listings, real paths,
// the Run walk, the git marker) reports its key and fingerprint. The
// validator is a digest of the route and those fingerprints, and the
// dependency list is kept in a bounded, process-local map. A request whose
// `If-None-Match` names a known validator for the same route re-validates the
// dependencies — inside their recorded windows that touches nothing — and
// gets a `304` without the body being recomputed. Anything else is a `200`
// with a fresh validator.

import { AsyncLocalStorage } from 'node:async_hooks'
import type { RouteContext } from './http/pipeline.js'
import { writeJson } from './http/respond.js'
import {
  type DependencySink,
  digest,
  type ObservedDependency,
  setDependencySinkProvider,
} from './read-index.js'

const recorder = new AsyncLocalStorage<DependencySink>()
setDependencySinkProvider(() => recorder.getStore())

/** Validators this process issued, newest last. */
const VALIDATOR_LIMIT = 1024
const validators = new Map<string, { routeKey: string; dependencies: ObservedDependency[] }>()

/** Cache policy of a validated list response. */
export const CONDITIONAL_CACHE_CONTROL = 'private, no-cache'

/** Run `compute`, collecting every index observation it makes. */
export async function recordDependencies<T>(
  compute: () => Promise<T>,
): Promise<{ value: T; dependencies: ObservedDependency[] }> {
  const observed = new Map<string, ObservedDependency>()
  const value = await recorder.run((dependency) => {
    observed.set(dependency.key, dependency)
  }, compute)
  return { value, dependencies: [...observed.values()] }
}

export function validatorFor(
  routeKey: string,
  dependencies: readonly ObservedDependency[],
): string {
  const parts = dependencies
    .map((dependency) => `${dependency.key}=${dependency.fingerprint ?? '-'}`)
    .sort()
  return `W/"${digest([routeKey, ...parts])}"`
}

function remember(validator: string, routeKey: string, dependencies: ObservedDependency[]): void {
  validators.delete(validator)
  validators.set(validator, { routeKey, dependencies })
  while (validators.size > VALIDATOR_LIMIT) {
    const oldest = validators.keys().next()
    if (oldest.done) break
    validators.delete(oldest.value)
  }
}

/** True when every recorded dependency still has its recorded fingerprint. */
async function unchanged(dependencies: readonly ObservedDependency[]): Promise<boolean> {
  const current = await Promise.all(dependencies.map((dependency) => dependency.revalidate()))
  return current.every((fingerprint, index) => fingerprint === dependencies[index]!.fingerprint)
}

/** The route identity a validator is bound to. */
export function routeKeyOf(ctx: RouteContext): string {
  const path = (ctx.request.url ?? '').split('?')[0]
  const query = [...ctx.search.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('&')
  return `${ctx.project} ${path}?${query}`
}

/**
 * Answer `If-None-Match` with `304` when a named validator's dependencies are
 * unchanged; otherwise compute the body and answer `200` with a validator.
 */
export async function respondConditionally(
  ctx: RouteContext,
  compute: () => Promise<unknown>,
): Promise<void> {
  const routeKey = routeKeyOf(ctx)
  const header = ctx.request.headers['if-none-match']
  const offered = (Array.isArray(header) ? header.join(',') : (header ?? ''))
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  for (const validator of offered) {
    const known = validators.get(validator)
    if (!known || known.routeKey !== routeKey) continue
    if (await unchanged(known.dependencies)) {
      remember(validator, routeKey, known.dependencies)
      ctx.response.writeHead(304, { etag: validator, 'cache-control': CONDITIONAL_CACHE_CONTROL })
      ctx.response.end()
      return
    }
  }
  const { value, dependencies } = await recordDependencies(compute)
  const validator = validatorFor(routeKey, dependencies)
  remember(validator, routeKey, dependencies)
  writeJson(ctx.response, 200, value, undefined, {
    etag: validator,
    'cache-control': CONDITIONAL_CACHE_CONTROL,
  })
}

/** Test seam. */
export function __resetConditionalReadsForTests(): void {
  validators.clear()
}
