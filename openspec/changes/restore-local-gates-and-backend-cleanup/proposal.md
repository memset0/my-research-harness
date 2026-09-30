## Why

A repository audit found that the local quality gates never run (no Git hook is installed, core typecheck fails, ~316 files drift from the Biome format), a viewer holding one project's share can hydrate another project's Run README through the legacy `/p/<project>/experiments/<id>` page, several writers still put UTC timestamps on disk, a handful of CLI failures bypass the structured error path, and ~3,600 lines of retired Backend daemon/distribution/update code still ship in `@memon/backend`. Each item is small; together they restore the invariants the repo already claims.

## What Changes

- Exclude the shadcn-generated `apps/web/components/ui/` directory from Biome lint and format, then apply `biome format` once across the workspace (whitespace/quotes/commas only).
- The server-rendered Run detail page `/p/<project>/experiments/<id>` and its metadata return 404 unless the resolved Run belongs to `<project>`; the prefetched query key matches the key the client component reads.
- The shared declaration/payload drift test moves from `@memon/core` into `apps/web` so core never imports Web sources; `pnpm -r typecheck` and `biome lint .` become error-free.
- Scan results, membership anomaly `detectedAt` and code-review `updated_at` use the local-offset ISO8601 formatter; duplicate local-offset formatters in core are replaced by `time.ts`.
- CLI mtime/hash conflicts in `run status set`, `run readme write`, `experiment status set` and `experiment warning` write through the structured error emitter (exit 9, receipt outcome conflict). `memon hypo show` and `memon show` exit 4 for NOT_FOUND with the error on stderr. Commander parse failures exit 2. **BREAKING** (exit codes only): callers that branched on exit 1 for these not-found and parse cases now see 4 and 2; conflict state moves into `error.details`.
- Remove `@memon/backend`'s retired daemon, release distribution, update activation and start-guard modules together with their exports and tests.
- Root `prepare` installs lefthook hooks only inside a Git checkout that has lefthook available and silently skips elsewhere (exported release trees, CLI-only installs). `.gitignore` covers the root `/.memon/` and `.claude/worktrees/`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `auth-system`: server-rendered project pages hydrate only resources of the requested project.
- `memon-cli`: exit-code dictionary scenarios for conflict emission, NOT_FOUND on `hypo show`/`show`, and parser failures.
- `experiment-discovery`: generated scan/membership/code-review timestamps carry the local offset.
- `cluster-backend-lifecycle`: the Backend package no longer ships retired lifecycle modules.
- `test-suite`: local pre-commit gates are installed, green, and never import across package sources.

## Impact

- `biome.json`, formatting-only edits across the workspace.
- `apps/web/app/p/[project]/experiments/[id]/page.tsx` (+ test), `apps/web/lib/server/data.ts`, new `apps/web/lib/components/shared-grammar.test.ts`.
- `packages/core/src/{time.ts,cli/scan.ts,experiments/membership.ts,experiments/rename.ts,git/commit-marks.ts,discovery/read.ts,project-file-store.ts}`, removal of `packages/core/src/components/shared-grammar.test.ts`, small lint fixes.
- `packages/backend/src/{document-service.ts,index.ts,package-boundary.test.ts}`, deletion of `daemon/`, `distribution/`, `update/`, `start-guards.ts`.
- `packages/cli/src/{index.ts,commands/experiment.ts,experiment-doc.ts,warning.ts,hypo.ts,show.ts}`.
- Root `package.json`, new `scripts/install-git-hooks.mjs`, `.gitignore`.
- Release surfaces: `cli` and `central` → MINOR.
