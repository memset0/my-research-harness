## Context

See proposal.md for motivation. Current state:

- Every package `tsconfig.json` extends `tsconfig.base.json` with
  `rootDir: src`, `outDir: dist`; `tsconfig.build.json` extends it and excludes
  tests. `typecheck` is `tsc -p tsconfig.json --noEmit`, so workspace imports
  resolve through `package.json` `types` to `dist/*.d.ts`. Nothing builds those
  first; a stale or missing `dist/` hides or fakes errors.
- Warm `pnpm -r typecheck` takes about 12-14 s (five `tsc` processes, partly
  parallel).
- `memon update` installs `--filter @memon/cli...`, then runs
  `pnpm --filter @memon/core build` and `pnpm --filter @memon/cli build`
  (`clean-package-dist.mjs` + `tsc -p tsconfig.build.json`), then runs the new
  binary. Any change must keep that path working.
- The Web app's `tsconfig.json` is also read by `next build` (and rewritten by
  Next on occasion), so it must keep resolving workspace packages through
  their built output for the production bundle.

Dependency graph (workspace edges only):

```
core  <-  skills  <-  cli
  ^                    |
  +--------------------+
core  <-  backend  <-  web
core  <------------------  web
test-utils  (no workspace deps; used by tests of backend, cli, web)
```

## Goals / Non-Goals

**Goals:**
- `pnpm typecheck` reports a dependent's breakage the moment a core export
  changes, with no build and no `dist/` at all.
- Warm, all-green typecheck no slower than today.
- `pnpm build`, `dist/` contents, `clean-package-dist.mjs` and the
  `memon update` build sequence unchanged.
- One home for test fixtures and one vitest preset.

**Non-Goals:**
- vitest 2 → 5, jsdom 25 → 30, TypeScript 5.9 → 7 (Future).
- Moving Web tests between `test/` and source-adjacent locations (Future).
- Adopting test-utils inside `packages/core` tests (owned by concurrent work;
  later adoption).
- Changing what `pnpm test` builds before running suites.

## Decisions

### D1. Project references with a declaration cache, separate from the build

Each TS package gets two configs:

- `tsconfig.json` (typecheck / editor): `composite: true`,
  `emitDeclarationOnly: true`, `outDir` and `tsBuildInfoFile` under
  `./node_modules/.cache/tsbuild/`, `paths` mapping each imported workspace
  package to its `src/index.ts`, and `references` to those packages.
- `tsconfig.build.json`: standalone (extends `tsconfig.base.json` directly),
  same `rootDir`/`outDir: dist`/`types` as before, tests excluded, no
  `composite`, no `paths`, no `references`. Byte-identical `dist/` was
  verified by building with the old and new configs and diffing.

Because `paths` points imports at a referenced composite project's source
file, `tsc -b` substitutes the referenced project's freshly built declaration
(in its cache), building references first. Typecheck therefore never reads or
writes `dist/`.

Root `tsconfig.json` is a solution config (`files: []`) referencing core,
skills, backend, cli, test-utils and `apps/web/tsconfig.typecheck.json`.
`apps/web/tsconfig.typecheck.json` extends the Next-owned `tsconfig.json`,
keeps `noEmit`, adds `paths` for `@memon/core`,
`@memon/core/wiki-kinds.json` (→ `src/wiki/kinds.json`), `@memon/backend` and
`@memon/test-utils`, and references their projects. A non-composite leaf
project can be built by `tsc -b` with `noEmit`, so it can sit in the root
solution. `next build` keeps using the untouched `tsconfig.json`.

Scripts: root `typecheck` = `tsc -b`; package `typecheck` = `tsc -b`
(Web: `tsc -b tsconfig.typecheck.json`); package `dev` watch scripts move to
`tsconfig.build.json` because `tsconfig.json` no longer emits JavaScript.
`pnpm -r typecheck` still works: pnpm runs packages in topological order, so a
dependent's `tsc -b` finds its references already up to date.

Alternatives considered:
- `tsc -b` emitting declarations into `dist/` (the brief's fallback): rejected
  because typecheck would then write into a live server's build output (F5),
  leave `dist/` with fresh `.d.ts` beside stale `.js`, and interleave with
  `clean-package-dist.mjs`.
- `paths` to source without references: every dependent re-checks core's
  source inside its own program (slower) and trips `rootDir` (TS6059).
- A custom `exports` condition pointing at source: touches package manifests
  read by Next/vite at runtime; `paths` is typecheck-only.

The cache directory sits inside each package's `node_modules/`, which is
already Git- and Biome-ignored, and its `tsbuildinfo` lives in the same
directory so deleting either deletes both (an orphaned buildinfo would make
`tsc -b` skip a rebuild of missing declarations).

### D2. `memon update` stays on the build configs

`update.ts` is unchanged: it builds with `pnpm --filter <pkg> build`, which
uses the standalone `tsconfig.build.json`. Verified with the existing
`update.test.ts` plus a `git archive` export where
`pnpm install --frozen-lockfile --filter @memon/cli...` and both builds run.

Observed while verifying (pre-existing, unchanged by this change, out of
scope): in a fresh export that has never built `@memon/skills`, the CLI build
fails with TS2307 on `import('@memon/skills')` because `memon update` builds
only core and cli and `packages/skills/dist` is absent. The same export with
the old configs fails identically; with a skills `dist/` present (any
previously built node) the CLI builds and `memon --version` runs. Recorded as
Future.

### D3. `@memon/test-utils`, consumed by alias rather than dependency

`packages/test-utils` is private, has no build, and is never declared as a
dependency of another package. pnpm's `--filter @memon/cli...` selection
follows devDependencies, so a devDependency edge from the CLI would pull the
package into `memon update` installs. Instead the shared vitest preset aliases
`@memon/test-utils` to its `src/index.ts`, and the typecheck configs map it
with `paths` + `references`. Its only dependencies are its own devDependencies
(`vitest`, `@types/node`, `typescript`), the same versions the suites use, so
it shares the runner's vitest instance. It has no workspace dependency, so
core can adopt it later without a cycle.

API (`src/index.ts`):

| Export | Purpose |
|---|---|
| `makeTempDir(prefix?)` / `removeTempDirs()` | tracked `mkdtemp` under the OS temp dir; one call in `afterEach` removes all |
| `createTempProject({ runs, experiments, wiki, files, prefix })` | temp project root with run READMEs, experiment bundles under `docs/experiments/`, wiki pages under `docs/wiki/`, arbitrary files; returns `{ root, path(...), cleanup() }`, also tracked |
| `useFixedClock(at)` | fake `Date` only (timers stay real); returns `restore()` |
| `actorHeader(actor)` | base64url JSON of an actor context (no canonicalization) |
| `createBackendRequest({ origin, token, actorHeaderName })` | returns `request(path, { actor, service, method, body, base })` with the bearer token unless `service: false`, JSON body + content type when `body` is set |
| `startBackend(server, registry?)` | listen on `127.0.0.1:0`, resolve `http://127.0.0.1:<port>`, add to `registry` |
| `paramsFor(project, extra?)` | Next route context `{ params: Promise.resolve({ project, ...extra }) }` |
| `ExitCalled`, `spyExit()` | replace `process.exit` with a throw; `{ restore(), code }` |
| `git(cwd, ...args)`, `initGitRepo(dir, opts?)`, `commitAll(dir, message)` | trimmed-stdout git runner; init with branch + identity; stage-all commit returning the SHA |

Replacement policy: only helpers whose behavior is identical to the shared one
are replaced; the report lists the variants kept (for example a canonicalizing
`actorHeader`, positional `request(origin, method, path)` signatures, the
synchronous env-identity `git` in `update.test.ts`).

### D4. One vitest preset

`packages/test-utils/src/vitest-preset.ts` exports `memonVitestPreset`, merged
by every package's `vitest.config.ts` via `mergeConfig`: `testTimeout: 30_000`
(the CLI's existing value, now uniform), `reporters: ['default']`,
`globals: false`, `environment: 'node'`, `include: ['src/**/*.test.ts']`, aliases for `server-only` (stub in test-utils) and
`@memon/test-utils`, plus `workspaceSource(pkg)` returning a package's
`src/index.ts` for source aliases. It lives in test-utils' `src/` (inside its
composite project, so the Web typecheck sees its declarations) rather than at
the repository root, because the root has no `vitest` dependency to type it.
The old `apps/web/test/server-only-stub.ts` moves into test-utils.
Backend and skills gain `vitest.config.ts`. Web keeps `environment: 'jsdom'`;
Web tests that never touch DOM APIs gain `// @vitest-environment node` (only
the comment line changes), and each converted file is run under node before it
is kept: 27 `.ts` files without Testing Library or `document`/`window`/storage/
`navigator` usage were converted and all pass under node, leaving 60 Web files
on the jsdom default.

Commit order note: the preset commit lands before the helper-adoption commits,
because the adopted tests resolve `@memon/test-utils` through the preset's
alias.

### D5. Web test location convention (documented only)

Component and hook tests live beside their source; cross-route and
multi-module integration tests live under `apps/web/test/`. No files move in
this change.

### D6. Pre-commit

`lefthook.yml` typecheck command becomes `pnpm typecheck` (one incremental
`tsc -b`). Measured on a real commit.

## Risks / Trade-offs

- [Cache drift: `node_modules/.cache/tsbuild` survives across branches] →
  `tsc -b` compares source timestamps/hashes against the buildinfo and rebuilds
  what changed; deleting `node_modules` resets it.
- [Concurrent `tsc -b` invocations writing the same cache (two hooks at once)]
  → writes are whole-file and declarations are deterministic; worst case a
  second run rebuilds. `pnpm -r typecheck` is topologically ordered.
- [`paths` drift when a package gains a new workspace import] → `tsc -b`
  fails with TS6307/TS6059 rather than silently reading `dist/`.
- [Uniform 30 s timeout hides a slow test longer] → acceptable; the timeout
  was already 30 s for the largest suite.

## Migration Plan

Config-only. Rollback is reverting the commits; no on-disk or wire state.

## Future

- vitest 2 → 5 and jsdom 25 → 30 together, then TypeScript 7.
- Move Web tests to the D5 convention.
- Make `memon update` build `@memon/skills` declarations (or type the dynamic
  import) so a never-built CLI-only export can build the CLI.
- Adopt `@memon/test-utils` in core tests and in the remaining ad-hoc
  `mkdtemp` sites.
