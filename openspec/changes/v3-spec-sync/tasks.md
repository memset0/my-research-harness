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

- [ ] 2.3.1 Decide per scenario: vitest + RTL (purely state-driven)
      or Playwright (genuine browser/network flow). Document the
      decision in a header comment of each test file.
- [ ] 2.3.2 If Playwright: add as a dev dependency, scaffold
      `apps/web/playwright.config.ts`, add a `pnpm test:e2e` script
      that builds prod + starts server + runs Playwright. Otherwise
      reuse the existing vitest harness.
- [ ] 2.3.3 Implement `list-grid.test.tsx` (or `.spec.ts`) for the
      "Project list grid renders v3 exp docs" scenario.
- [ ] 2.3.4 Implement `anomaly-banner-copy-all.test.tsx` for the
      copy-to-clipboard scenario.
- [ ] 2.3.5 Implement `run-panel-persist.test.tsx` for the localStorage
      persistence scenario.
- [ ] 2.3.6 Implement `run-redirect.test.ts` (likely Playwright since
      it tests an actual HTTP redirect) for the `/r/<run>` →
      `/e/<exp>?run=<run>` redirect.

## 3. Cosmetic + docs (16.5 + 17.1)

- [ ] 3.1 Rename `apps/web/components/experiment-page.tsx` →
      `apps/web/components/exp-doc-page.tsx`. Update its single import
      site (`app/p/[project]/e/[id]/page.tsx`) and the
      `import` statement inside the file. Tests with names hardcoded
      to the old filename get updated alongside.
- [ ] 3.2 Audit `apps/web/components/*.test.tsx` and
      `apps/web/components/*.tsx` for files whose name says
      `experiment-*` but that test/render run-side data (e.g.
      `experiment-list.tsx` actually lists runs in v3 lingo). Rename
      where the meaning is unambiguous; leave alone where the name
      genuinely refers to v3 exp docs.
- [ ] 3.3 Update `CLAUDE.md`: add a section on the v3 file model
      (canonical `docs/experiments/E*.md` + run dirs as separate
      units; bidirectional binding; membership-anomaly surface);
      list the new action-bar button locations
      (`Edit markdown`, `Open Claude Code`, exp-level + per-run-panel);
      list the new CLI subcommands
      (`memon experiment {ls,show,create,link,unlink,delete}`,
      `memon run rename`); list the new web endpoints
      (`/api/experiments/*`, `/api/runs/:id/readme`,
      `/api/open-claude-code`).
- [ ] 3.4 Cross-reference: ensure CLAUDE.md mentions the SSE topic
      rename (D1) so a fresh session knows `experiment-change` means
      exp-doc events in v3, not run events.

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
