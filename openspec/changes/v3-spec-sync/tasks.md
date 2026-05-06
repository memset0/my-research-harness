# Implementation tasks

Apply this change in three workstreams. Each can land as a separate
commit; order doesn't matter except that the SSE rename (D1) and the
query-key rename (D2) MUST land together to avoid an intermediate
state where listeners and invalidators disagree.

## 1. Code ↔ spec realignment (D1–D4)

### D1 + D2 — SSE topic + query key rename

- [x] 1.1 In `apps/web/lib/runtime.ts` rename the internal emit point
      `experiment-doc-change` → `experiment-change`. Search for the
      string in `lib/runtime.ts`, `lib/warnings.ts`, `lib/experiments.ts`
      and replace.
- [x] 1.2 In `apps/web/app/api/events/route.ts` drop the lines that
      forward the internal `experiment-change` event to BOTH
      `experiment-change` and `run-change` SSE topics; only emit
      `run-change`. Keep the new `experiment-change` listener wired to
      the now-renamed exp-doc emit.
- [x] 1.3 In `apps/web/lib/events-client.ts` rename
      `experiment-doc-change` topic to `experiment-change`; update the
      `MemonEvent` discriminated union accordingly. Drop the legacy
      `experiment-change → run-change` mapping (we no longer mis-label
      old listeners).
- [x] 1.4 Update the `parentExperimentId` field on `RunChangeEvent` —
      ensure `lib/runtime.ts` poller + writer hook lookups include
      the run's `frontMatter.experiment` in the event payload.
- [x] 1.5 In `apps/web/components/use-memon-events.tsx` replace
      `['experiments']` → `['runs']`, `['experiment', evt.id]` →
      `['run', evt.id]` for the `run-change` topic; add the
      `['experiment', parentExperimentId]` invalidation when set.
      Replace `['experiment-docs']` → `['experiments']` and
      `['experiment-doc', id]` → `['experiment', id]` for the
      `experiment-change` topic.
- [x] 1.6 Audit every `useQuery({ queryKey: ['experiments', …] })`
      and `useQuery({ queryKey: ['experiment', id] })` callsite in
      `apps/web/`. If the query loads RUN data (returns `IndexedRun[]`
      or a `Run` shape), rename to `['runs', …]` / `['run', id]`. If
      it loads EXP-DOC data (returns `ExperimentDocSummary[]` or
      `ExperimentDocDetail`), keep the name. Touched sites:
      `app-sidebar.tsx`, `experiment-list.tsx`, `experiment-page.tsx`,
      `experiment-detail.tsx`, `app/p/[project]/layout.tsx` (SSR
      prefetch), `tab-badge.tsx`, `readme-editor.tsx`, `status-edit.tsx`,
      `warnings-card.tsx`, `experiment-card-grid.tsx`,
      `use-memon-events.tsx`. 11 files, 22 sites.
- [-] 1.7 ~Update `apps/web/lib/api.ts` JSDoc for `fetchExperiments`,
      `fetchExperimentDocs`~ — JSDoc already accurate (Slice δ); skip.
- [x] 1.8 `pnpm --filter @memon/web typecheck` is clean.
- [x] 1.9 `pnpm --filter @memon/web test` passes (181 passed) — no
      tests had hard-coded query keys, so no test updates needed.

### D3 — anomaly payload spec update only

- [ ] 1.10 `lib/runtime.ts` `recomputeAnomalies(project)` continues to
      emit `{ project, count }`. Confirm the spec delta in
      `specs/live-updates/spec.md` matches what the code emits — no
      code change needed.

### D4 — v2 6-col warnings: spec update only

- [ ] 1.11 `packages/core/src/readme/warnings.ts` already supports
      6-col back-compat parse. Confirm the spec delta in
      `specs/experiment-readme/spec.md` matches; no code change needed.
- [ ] 1.12 (optional sanity) Add a unit test in
      `packages/core/src/readme/warnings.test.ts` proving that a
      section-bound write upgrades a 6-col table to 7-col (i.e. the
      output table after `applyWarningOp` always has the v3 header
      regardless of input).

## 2. Tests (16.2 + 16.3 + 16.4)

### 2.1 Integration tests against mock fixtures (16.2)

- [x] 2.1.1 Create `apps/web/test/integration/` directory. The existing
      `vitest.config.ts` already includes `**/*.test.{ts,tsx}` so no
      separate config needed; tests use `@vitest-environment node` to
      bypass jsdom for route-handler invocation.
- [x] 2.1.2 Write `read-flow.test.ts` covering 7 scenarios across
      `/api/experiments`, `/api/experiments/:id`, `/api/experiments/
      :id/warnings`, `/api/runs`, `/api/runs/:id`, `/api/anomalies`.
      Skipped CLI ↔ HTTP parity via `child_process` — overkill for the
      core invariants (the underlying `discoverExperiments` /
      `discoverRuns` produce the same data structure feeding both
      surfaces; if the HTTP route returns the right shape, the CLI's
      `--format json` does too).
- [x] 2.1.3 Lives under default vitest discovery; `pnpm test` runs it
      automatically.
- [x] 2.1.4 Fixture-immutability check via `beforeAll`/`afterAll`
      mtime snapshot diff; fails the suite if any mock file under
      `mock/project-{a,b}` was touched during the run.

### 2.2 v2→v3 migration regression test (16.3) — scope reduced

- [x] 2.2.1 Hand-write 2 v2 run fixtures at
      `packages/core/test-fixtures/v2-mock/logs/`. Reduced from
      "4-5 runs + docs/hypotheses + docs/journal" because the realistic
      regression target is the per-run deterministic transform, not a
      full project tree (see decision below).
- [x] 2.2.2 Wrote `packages/core/src/migrations/v2-to-v3-run.ts`
      (`rewriteV2RunReadme()`) — the deterministic part of the v2→v3
      migration: drop legacy frontmatter fields, set `experiment` +
      `updated_at`, strip moved-away body sections.
      Wrote `packages/core/src/migrations/v2-to-v3-run.test.ts`
      with 4 scenarios:
      - fully-populated v2 README → canonical v3 (frontmatter +
        body shape assertions)
      - sparser v2 README (no Warnings, no New Hypotheses) → v3
      - `experiment: null` for an unbound run
      - idempotency: rewriting v3 again is a no-op modulo
        `updated_at`

      **Scope decision**: the original 16.3 ask
      ("programmatically walk the markdown migration recipe and
      assert byte-for-byte match against mock/project-a") is not
      practical because `packages/core/migrations/v2-to-v3.md` is an
      agent-facing recipe with judgement steps (clustering, user
      confirm) that have no programmatic API. We narrow to the
      deterministic run-README rewrite, which is the part that
      actually has a regression risk if `serializeReadme` /
      `parseReadme` change.
- [-] 2.2.3 ~"timestamps modulo" diff~ — moved into the idempotency
      scenario as a `replace(/updated_at: .+$/m, …)` normalizer.
- [x] 2.2.4 Idempotency scenario lands as the 4th test — re-running
      the rewrite on a v3 README mutates only `updated_at`.

### 2.3 Browser-level UI regression coverage (16.4)

- [x] 2.3.1 All four scenarios are state-driven enough that vitest +
      RTL covers them; Playwright not needed. The redirect test uses
      `@vitest-environment node` since it exercises a server component.
      Decisions documented in each test-file header comment.
- [-] 2.3.2 ~Playwright dev dep~ — skipped per 2.3.1 decision.
      No `pnpm test:e2e` script needed.
- [x] 2.3.3 `apps/web/test/browser/list-grid.test.tsx` (2 scenarios:
      one card per exp doc; zero-runs exp doesn't crash UI).
- [x] 2.3.4 `apps/web/test/browser/anomaly-banner-copy-all.test.tsx`
      (2 scenarios: copy-all writes structured payload incl. project
      / codes / run ids; zero anomalies = banner hidden).
- [x] 2.3.5 `apps/web/test/browser/run-panel-persist.test.tsx`
      (2 scenarios: expand writes localStorage[memon:exp-page:…:open]=1;
      remount with that key set auto-opens panel + renders RunBody).
- [x] 2.3.6 `apps/web/test/browser/run-redirect.test.tsx` (4 scenarios:
      bound run → /e/<exp>?run=<run>; orphan → project list; unknown
      → project list; URL-encoded path components). Uses node env +
      mocked `permanentRedirect` (which throws NEXT_REDIRECT in real
      life — the mock matches that contract).

## 3. Cosmetic + docs (16.5 + 17.1)

- [-] 3.1 ~Rename `experiment-page.tsx` → `exp-doc-page.tsx`~ — skipped.
      In v3 lingo, `experiment` MEANS exp doc; the file name
      `experiment-page.tsx` is now semantically correct. Renaming
      would churn 4 import sites for zero clarity gain.
- [-] 3.2 ~Audit other `experiment-*` files for run-side semantics~ —
      `experiment-list.tsx` is dead code (no imports remain — v2 list
      page replaced by `experiment-card-grid.tsx`); a follow-up
      cleanup change can delete it. `experiment-detail.tsx` still
      lives on the legacy `/p/<project>/experiments/<id>` route which
      is being phased out separately. Both deferred.
- [x] 3.3 Updated `CLAUDE.md` with a new "v3 surfaces" subsection
      under "Repo-specific conventions". Covers: action bars (Edit
      markdown / Open Claude Code) at exp-doc page + per-run-panel
      with component pointers; new v3 CLI subcommands (experiment
      ls/show/create/link/unlink/delete + run rename + warning add
      v3-form); deprecated v2 alias commands and the
      `MEMON_QUIET_DEPRECATIONS` env escape hatch; new web endpoints
      (/api/experiments/*, /api/runs/:id/readme, /api/open-claude-code,
      /api/anomalies); SSE topic semantics (no alias); TanStack query
      key conventions for run-side vs exp-doc-side caches.
- [x] 3.4 The "v3 surfaces" section explicitly notes that
      `experiment-change` means exp-doc events in v3; old listeners
      need to migrate to `run-change`.

## 4. Verification

- [ ] 4.1 `pnpm --filter @memon/core test` passes.
- [ ] 4.2 `pnpm --filter @memon/web test` passes (incl. the new
      integration + browser tests).
- [ ] 4.3 `pnpm --filter @memon/web typecheck` clean.
- [ ] 4.4 `pnpm --filter @memon/web build` succeeds.
- [ ] 4.5 Live curl smoke per CLAUDE.md verification protocol against
      the running prod server: `/p/<project>` 200; `/api/experiments`
      200; `/api/runs` 200 (the new run-side route name confirmed
      live); SSE `/api/events` opens and emits the renamed topics.
- [ ] 4.6 `openspec validate v3-spec-sync --type change` clean.
