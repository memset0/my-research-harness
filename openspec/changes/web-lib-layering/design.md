## Context

See proposal.md for motivation. Constraints that shape the approach:

- The production host is the custom entry `apps/web/server.ts`, loaded by `tsx`
  as plain Node. Everything it imports (statically or through its dynamic
  `import()`s) is resolved by Node, not by Next's bundler. The `server-only`
  package is not a dependency of the workspace (Next aliases the bare
  specifier to its compiled copy only inside bundles), and its default export
  throws outside the `react-server` condition, so a module in the entry's
  import graph cannot `import 'server-only'` without crashing boot.
- `apps/web/middleware.ts` runs in the Node middleware runtime and is bundled by
  Next, so its exclusive dependencies may carry the marker.
- `lib/server/api-route-manifest.test.ts` inventories every non-API file that
  calls `getRuntime(` and exempts `lib/runtime.ts` by path; moving files must
  keep that inventory exact.
- TanStack matches invalidations by key prefix after hashing, so a key's runtime
  value (not its TypeScript type) is the contract between readers, prefetchers
  and invalidators. Several call sites spell the same root differently today.
- Another agent edits `packages/backend` concurrently; this change touches only
  `apps/web/**` and its own change directory.

## Goals / Non-Goals

**Goals:**
- A single, mechanically checkable boundary: `lib/server/**` is server code,
  `lib/` outside it is client-safe or shared.
- One definition of every query key, with its runtime shape locked by tests.
- Routes and fetchers type-checked against the same response DTOs.

**Non-Goals:**
- No wire-shape, HTTP-status, rendering or cache-behavior changes. Latent key
  mismatches found while centralizing are preserved and reported, not fixed.
- No merge of the `/p` and `/h` page trees (see Future).
- No edits to `AGENTS.md` or canonical specs outside the delta workflow.

## Decisions

### D1. Directory layering

Before (server-only modules flat beside client hooks):

```
lib/
  api.ts  runtime.ts  runtime-config-path.ts  server-core.ts  route-prewarm.ts
  path-safety.ts  warnings.ts  use-*.ts  ...
  auth/  central/  runtime/  slurm/  translation/  components/
  server/   (data.ts is the only module marked server-only)
```

After:

```
lib/                       client-safe or shared (hooks, fetchers, URL helpers,
  api.ts                   pure parsers, component registry, query-keys.ts)
  query-keys.ts
  dto/<domain>.ts          response types + pure helpers only
  translation/{segments,sources,target}.ts   shared with client components
  components/              shared descriptor registry (unchanged)
  server/                  every server-only module
    auth/  central/  runtime/  slurm/  translation/{cache,codex,http,manifest,service}.ts
    runtime.ts  runtime-config-path.ts  server-core.ts  route-prewarm.ts  path-safety.ts
    data.ts  standalone-*.ts  wiki-route.ts  ...  (existing)
```

- Classification rule: a module is server-only when it imports `node:*`,
  `@memon/backend`, a value from `@memon/core` (beyond the JSON wiki-kinds
  table), calls `getRuntime(`, or is only imported by such modules/entries.
- Moves use `git mv`; import specifiers are rewritten by resolving each
  specifier against the importer's old location and re-relativizing it from
  the new one, preserving the existing `@/` vs relative style (including
  `vi.mock` / dynamic `import()` specifiers).
- Marker: every non-test module under `lib/server/` starts with
  `import 'server-only'`, except modules reachable through value imports from
  `server.ts`. A test computes that reachable set from the entry's import graph
  and asserts both directions (unreachable ⇒ marked; reachable ⇒ unmarked), so
  the exemption list cannot rot. Alternative considered: a Node resolve hook in
  the start script to stub `server-only` — rejected because it changes the
  production start command for no runtime benefit (entry-graph modules already
  import `node:*` and fail a client build on their own).
- Vitest aliases `server-only` to an empty stub so Node tests can import marked
  modules; existing `vi.mock('server-only')` calls keep working.
- `lib/warnings.ts` has no non-test importer and no test; it is deleted.

### D2. Query key factory

`lib/query-keys.ts` exports `queryKeys`, an object of constructors returning
`as const` tuples. Project-scoped keys spread `projectQueryKey(target)` (so a
plain string project yields `[root, project, …]` and a Host-qualified one
`[root, host, project, …]`), exactly as the call sites already did. The
Project-addressing helpers (`ProjectTarget`, `projectName`, `projectHost`,
`projectQueryKey`, `projectSearchParams`, `projectWebPath`) move from
`lib/api.ts` into the pure `lib/project-target.ts` (re-exported by `lib/api.ts`)
so the factory does not depend on the fetcher module — tests that mock
`lib/api` wholesale would otherwise lose `projectQueryKey`.

| Constructor | Runtime shape |
|---|---|
| `projects()` / `hosts()` / `slurmStatus()` | `['projects']` / `['hosts']` / `['slurm-status']` |
| `allRuns()` | `['runs']` (prefix used for cross-project invalidation) |
| `runs(p?)` / `run(p?,id)` / `runFiles(p,id)` | `['runs',…P]` / `['run',…P,id]` / `['run-files',…P,id]`; `P` is empty when `p` is absent |
| `experiments(p?)` / `experiment(p?,id)` / `experimentsInventory(p)` | `['experiments',…P]` / `['experiment',…P,id]` / `['experiments-inventory',…P]` |
| `hypotheses(p)` / `journal(p)` / `journalHistory(p)` / `journalCount(p)` | `[root,…P]` |
| `reports(p)` / `report(p,id)` / `reportsInventory(p)` | `['reports',…P]` / `['report',…P,id]` / `['reports-inventory',…P]` |
| `reportsRawTarget(p)` | `['reports', p]` — preserves one legacy spelling (see Risks) |
| `codeReviews(p)` / `codeReview(p,id)` / `codeReviewsInventory(p)` / `codePreview(p,href)` | `[root,…P,…]` |
| `wiki(p)` / `wikiPage(p,id)` / `wikiInventory(p)` / `wikiReview(p)` / `wikiBacklinks(p,id)` | `[root,…P,…]` |
| `gitStatus(p)` / `gitStatusFiles(p,sub?)` / `submodules(p)` | `[root,…P]`, `gitStatusFiles` appends `sub` only when given |
| `gitDiff(p,path,side,sha,sub,from,to)` / `gitRange(p,sub,from,to)` | positional tuple, `undefined` slots kept |
| `gitBranches(p,sub)` / `gitLog(p,sub,rev)` / `gitCommit(p,sub,sha)` / `gitCommitAtRoot(p,sha)` / `commitMarks(p)` | `[root,…P,…]` |
| `logFiles(p,selector)` / `projectShares(p)` | `[root,…P,…]` |
| `fileAccess(windowMs)` / `docAsset(project,host,path)` | `['file-access',ms]` / `['doc-asset',project,host,path]` |
| `tabCollection(kind,p)` | delegates to the inventory/count constructor for that tab |

The survey produced 42 constructors; each has an inline snapshot test for a
string and (where Project-scoped) a Host-qualified target, plus a snapshot of
the constructor name list so a new constructor cannot land without one. The
root-classification sets in `lib/resource-policy.ts` and
`components/resource-heartbeat-provider.tsx` stay as they are (they classify
roots, they do not build keys). Alternative considered: hierarchical `['project', p, 'runs']` keys —
rejected because it changes runtime shapes and breaks SSR dehydration matches.

### D3. Shared DTO types

`lib/dto/<domain>.ts` with domains `projects`, `runs`, `experiments`,
`documents` (README read/write), `warnings`, `journal` (hypotheses + journal),
`reports`, `wiki`, `code-reviews` (incl. code preview), `logs`, `slurm`, `git`
(incl. commit marks), `shares`, `components`, plus `wire.ts`. DTO files contain
only types and import only types (from `@memon/core` or sibling DTOs); a purity
test enforces this. `lib/api.ts` keeps its fetchers and re-exports every DTO so
existing component imports keep compiling; new code imports from `lib/dto/*`.
Response shapes that fetchers spelled inline (`{ projects }`, `{ experiments }`,
`{ files }`, run files, journal, log lines, create/bind/delete, Report and
code-review writes, component runs, share rows) get names so both sides can
reference them.

Route handlers annotate the JSON they emit with `satisfies <Dto>` at the
`NextResponse.json(...)` site. When typecheck reveals a disagreement, the DTO is
corrected to the route's actual output (never the route). Because the central
Backend answers the same URL for Host-qualified Projects, a field only one side
emits becomes optional rather than removed.

`Wire<T>` (in `lib/dto/wire.ts`) widens every string-literal union in a DTO to
`string`. It is used only where a route's body comes from a backend zod wire
schema that types enum-like fields (Run/Experiment/Hypothesis status, journal
status transitions, managed-document `kind`) as `string` while the client DTO
keeps the narrow domain union the UI switches on. `satisfies Wire<Dto>` still
rejects missing, extra and differently shaped fields; a type-level test proves
it. Alternative considered: loosening the client DTOs to `string` — rejected
because it would push unchecked casts into every component that switches on a
status.

Routes not annotated: bodies that are opaque core types with no client DTO
(resource inventories, translation, file-access, UI preferences, Results views,
anomalies, auth, runtime health, wiki kinds), error bodies, and streaming or
byte routes.

### Route/DTO disagreements found while annotating

Corrected in the DTO to match the route's actual output:

- Git endpoints (`git-status`, `git-status/files`, `git-diff`, `git-range`,
  `git-branches`, `git-log`, `git-commit`, `submodules`): the routes can answer
  `enabled: false` with any backend disabled reason, including `not-found` and
  `no-gitmodules`, which most client unions omitted. Now one shared
  `GitDisabledReason`.
- `PATCH /api/{runs,experiments}/:id/archive`: `archived` is optional in the
  emitted body; the client declared it required.
- `GET /api/runs/:id/files`: the standalone route also emits `runPath`.
- `GET /api/readme`: emits `path` (not `resource`); the fetcher already mapped
  it, now through a named `PathReadmeResponse`.
- `POST /api/experiments`: the standalone route emits `{ ok, id, path, mtime }`
  without the `resource`/`hash` the client declared (only the central Backend
  sends those).
- `POST /api/experiments/:id/{link,unlink}`: the standalone route emits only
  `{ ok, experimentId, runId }`; the four lock tokens come from the central
  Backend only.
- `GET /api/hosts`: the route declared its own identical `HostsResponse`; it now
  uses the shared DTO.

Precision gaps (checked with `Wire<T>`, DTO unchanged): Run and Experiment
`frontMatter.status`, Hypothesis `status`, journal `statusFrom`/`statusTo`, and
managed-document `kind` are `string` in the backend wire schemas.

## Risks / Trade-offs

- [Rewrite misses a specifier form (string paths in tests, `readFileSync`
  paths)] → grep for every old path after the move; typecheck, the full web
  suite and a production `next build` must all pass.
- [`server-only` breaks the custom entry] → the entry-graph test forbids the
  marker on reachable modules; `next build` plus a `tsx` import smoke of
  `server.ts`'s graph via the test catch regressions.
- [Middleware bundle rejects the marker] → `next build` is the acceptance check;
  if it fails, the middleware-only modules are added to the exemption with the
  reason recorded here.
- [Preserving known-bad key spellings] → `reportsRawTarget` keeps the existing
  `['reports', project]` invalidation in the Report editor byte-identical; for
  a Host-qualified Project it does not match the list query. Reported as a
  follow-up fix rather than silently changed.
- [Re-exporting DTOs from `lib/api.ts` keeps a wide import surface] → accepted
  to avoid churning ~60 component imports in a pure refactor.

## Migration Plan

Pure refactor inside `apps/web`; ships with the next central PATCH release. No
data or config migration. Rollback is a revert of the commits.

## Future

- Merge the `/p/[project]` and `/h/[host]/p/[project]` page trees behind shared
  page factories: `/p` prefetches on the server while `/h` renders client-only,
  `/p` still carries the legacy `experiments/` and `r/` redirect routes, and the
  two layouts differ by ~200 lines. A factory taking a `ProjectTarget` and
  returning `{ generateMetadata, Page }` would let both trees prefetch through
  `queryKeys` and remove the drift. Deferred because it changes rendering and
  auth paths and needs browser verification across both trees.
- Fix the preserved key mismatches (`reportsRawTarget`, the `gitCommit` vs
  `gitCommitAtRoot` split) once each is verified in a browser.
- Narrow `lib/api.ts` re-exports once components import from `lib/dto/*`.
