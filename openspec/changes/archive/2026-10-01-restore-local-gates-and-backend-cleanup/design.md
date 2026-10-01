## Context

See proposal.md for motivation. The eight fixes touch every workspace package, so they are ordered to keep each step independently verifiable and to let the pre-commit hook (installed last) run against an already-green tree.

## Goals / Non-Goals

**Goals:**
- One formatting-only commit that later diffs can ignore.
- Every later step lands with `pnpm -r typecheck` unchanged or better, and the final state has zero typecheck and zero Biome errors.

**Non-Goals:**
- Splitting `server.ts`, unifying frontmatter/atomic-write helpers, or the other structural refactors from the audit.
- Regenerating shadcn primitives (only excluding them from Biome).
- Retiring `createBackendServer`: it is still the HTTP harness for ~19 backend and Web integration tests, so only the package-boundary assertion that treated it as product surface is removed.

## Decisions

1. **Format first, with `components/ui/` excluded.** The shadcn CLI owns those files (AGENTS.md F3), so they are excluded from both lint and format via `files.includes` negation; the old per-directory lint override becomes unnecessary. Alternative (format them too) would make every future `shadcn add --overwrite` produce a noisy diff. Generator outputs (`*.generated.ts[x]`) are excluded for the same reason: `component-docs --check` compares them byte-for-byte with the generator. Biome's default `organizeImports` assist is also an error under `biome check` (the pre-commit command), so import sorting is applied once in its own style commit; an AST comparison confirms only import order and re-export order changed and side-effect imports kept their positions.

2. **Keep and scope the legacy Run detail route instead of deleting it.** `/p/<project>/experiments/<id>` is still linked from the experiment list, hypothesis view and journal view, so it cannot be deleted. `getExperimentData(project, id)` returns `null` unless `run.project === project`; the page and `generateMetadata` both use it (metadata previously consulted the Experiment-doc index for a Run URL, which was both unscoped and the wrong index). The prefetch key becomes `['run', ...projectQueryKey(project), id]`, the key `ExperimentDetail` reads; the loader's shape already matches `fetchExperiment`.

3. **Move the declaration/payload parity test into `apps/web`.** The Web copies are imported by `'use client'` components (`components/components/index.tsx` → `payload`, `registry` → `declaration`), and client code must not pull `@memon/core` runtime. So both copies stay; the test moves to `apps/web/lib/components/shared-grammar.test.ts`, importing the core side from `@memon/core` (Web already depends on it), and the core copy of the test is deleted. Core typecheck then no longer reaches outside its `rootDir`.

4. **One local-offset formatter.** `formatIsoLocal` in `packages/core/src/time.ts` replaces `isoWithOffset`, `defaultNowIso` and `formatIsoNow`. The Run-directory `created_at` synthesis in `discovery/read.ts` reuses `parseTimestampFromRunDir`, which applies the offset in effect at that date (correct across DST) instead of today's offset. Backend imports `formatIsoLocal` from `@memon/core` (already a dependency).

5. **Conflicts go through `emitErrorAndExit('CONFLICT', message, details)`.** This is the pattern `run deprecate` already uses; it records the receipt outcome and derives exit 9. Retry state (`currentMtime`, `expectedMtime`, `currentHash`/`actualHash`) moves from top-level siblings of `error` into `error.details`; the current file content is still written to stdout first. No test, skill or Web caller reads the old top-level fields. NOT_FOUND in `hypo show`/`show` uses the same helper (exit 4, stderr only). Commander parse errors exit `EXIT.USAGE` (2) whenever Commander's own exit code is non-zero, except the help/version paths that already exit 0.

6. **Delete retired Backend lifecycle code outright.** `daemon/`, `distribution/`, `update/` and `start-guards.ts` have no importer outside themselves (verified by grepping every exported symbol across `apps/web`, `packages/cli`, `packages/core`, `packages/skills`, `scripts`). `packages/cli/src/commands/update.ts` (`memon update`) is unrelated and untouched. The backend's only dependency (`@memon/core`) remains needed.

7. **Hook install is a guarded script, not bare `lefthook install`.** Production deploys from a `git archive` export (no `.git`) with a full `pnpm install --frozen-lockfile`, and remote `memon update` runs a filtered install where root devDependencies such as lefthook may be absent. `prepare` therefore runs `node scripts/install-git-hooks.mjs`, which: exits 0 with `skip: not a git checkout` when no `.git` file or directory exists at the repo root (a worktree's `.git` is a file); exits 0 with a skip line when `lefthook/package.json` cannot be resolved via `createRequire`; otherwise runs `pnpm exec lefthook install` and propagates only its failure.

## Risks / Trade-offs

- [Formatting touches ~300 files and may conflict with a concurrent agent's edits] → The format commit is made first and only stages files whose diff is formatting; files owned by the concurrent change (`AGENTS.md`, `openspec/changes/slim-agents-instructions/`) are excluded from the commit.
- [Exit-code change breaks a script that matched exit 1 on not-found] → Documented as BREAKING in the proposal and shipped as a CLI MINOR release; bundled skills already branch on 4.
- [Conflict state moves into `error.details`] → Consistent with the documented envelope and existing `run deprecate` behavior; no known consumer of the old placement.
- [Pre-commit hook runs full workspace typecheck (~6 s)] → Acceptable; it was already the configured hook, only never installed.

## Migration Plan

No data migration. Release as MINOR (cli + central surfaces). Rollback is a normal revert of the relevant commit; deleting the Backend lifecycle modules has no runtime consumer to restore.
