## Why

`apps/web/lib` mixes server-only modules (Runtime access, `node:*`, `@memon/core`
value imports, `@memon/backend`) with browser hooks and fetch wrappers in one
flat directory, so nothing but reviewer memory stops a client component from
pulling server code into the browser bundle. TanStack query keys are spelled
as ad-hoc array literals at ~190 call sites (33+ roots, 35 invalidations), and
the 71 response types in `lib/api.ts` are declared only on the client, so a
route can drift from what its fetcher claims without any compile error.

## What Changes

- Move every server-only module under `apps/web/lib/` into `apps/web/lib/server/`
  (`auth/`, `central/`, `runtime/`, `slurm/`, the server half of `translation/`,
  `runtime.ts`, `runtime-config-path.ts`, `server-core.ts`, `route-prewarm.ts`,
  `path-safety.ts`) with `git mv`, and mark each Next-bundled one with
  `import 'server-only'`. Modules loaded by the custom Node entry
  (`server.ts`) cannot carry the marker; a test derives that set from the
  entry's import graph instead of a hand list. Delete `lib/warnings.ts`, which
  has no non-test importer (`lib/experiments.ts` is already gone).
- Add `apps/web/lib/query-keys.ts`, the single definition of every TanStack
  query key, and route all `queryKey`, `invalidateQueries`, `setQueryData`,
  `getQueryData`, `cancelQueries`, `prefetchQuery` and manual-refresh keys
  through it. Runtime key shapes stay byte-identical; a snapshot test locks
  each constructor.
- Add `apps/web/lib/dto/<domain>.ts` holding the response types now declared in
  `lib/api.ts`; `lib/api.ts` re-exports them for existing imports, and the
  matching `app/api/**/route.ts` handlers check their JSON bodies against the
  same types with `satisfies`. Wire shapes do not change; where a client type
  disagrees with what its route actually emits, the type is corrected to the
  route's output.
- Update the API route manifest's direct-Runtime inventory and every import
  path for the moved files.
- No HTTP, wire, rendering or on-disk behavior changes. The `/p` and `/h` page
  trees are not merged (recorded as future work in design.md).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-dashboard`: adds the code-organization contracts that server-only
  dashboard modules live under `lib/server` with a server-only guard, and that
  routes and client fetchers share one set of response DTO types.
- `live-updates`: adds the contract that every TanStack query key is built by
  the single key factory, so invalidations and prefetches match the reads.
- `slurm-status`: the startup probe and `squeue` parser requirements name
  module paths that move under `apps/web/lib/server/`.
- `auth-system`: the endpoint-classification requirement names
  `route-classes.ts`, which moves under `apps/web/lib/server/auth/`.

## Impact

- Code: `apps/web/lib/**`, `apps/web/app/**` (imports, route `satisfies`
  annotations, prefetch keys), `apps/web/components/**` (query keys, imports),
  `apps/web/server.ts`, `apps/web/middleware.ts`, tests that import or mock
  moved modules, `apps/web/vitest.config.ts` (alias `server-only` to an empty
  stub so Node tests can import marked modules).
- No new dependency: Next resolves `server-only` internally for bundled code.
- Release surface: central (Web) only; no CLI, skills or filesystem change.
- Documentation drift to report (not edited here): `AGENTS.md` paths for
  `path-safety.ts`, `translation/cache.ts`, `central/direct-runtime.ts` and
  the §5 query-key sentence; the `dev-route-prewarm` spec Purpose path.
