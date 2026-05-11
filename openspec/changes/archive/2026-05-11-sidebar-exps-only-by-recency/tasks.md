## 1. Sidebar component edits (`apps/web/components/app-sidebar.tsx`)

- [x] 1.1 Drop the `fetchExperiments` import and the `IndexedRun`
      type import (both move to "no longer used by this file";
      keep the `fetchExperimentDocs` and `ExperimentDocSummary`
      imports). Also dropped the now-unused `StatusPill` import.
- [x] 1.2 Delete the `ProjectExperiments` function entirely
      (lines for the run-list sub-section + its `useQuery`
      + the "loading…" / "no runs" placeholders + the `Runs`
      caption).
- [x] 1.3 In `ProjectGroup`'s body, remove the
      `<ProjectExperiments .../>` JSX line so each project group
      renders only `<ProjectExperimentDocs .../>`. Also dropped
      the now-unused `activeExperimentId` prop and the
      `pathname.match(/\/experiments\//)` line at the top.
- [x] 1.4 Remove the now-redundant `Experiments` uppercase caption
      `<div>` from the top of `ProjectExperimentDocs`.
- [x] 1.5 In `ProjectExperimentDocs`, sort `docs` by
      `effectiveUpdatedAt` descending via a `useMemo` wrapping
      `.slice().sort((a, b) => b.effectiveUpdatedAt.localeCompare(a.effectiveUpdatedAt))`
      before slicing to the visible window. Mirrors the exact
      pattern used in `experiment-card-grid.tsx`.
- [x] 1.6 Confirmed: empty-state branch (`docs.length === 0 &&
      !isLoading`) still returns `null`; projects with no v3 exp
      docs render no rows.

## 2. Test updates (`apps/web/components/app-sidebar.test.tsx`)

- [x] 2.1 Swapped `fetchExperiments` for `fetchExperimentDocs` in
      the `vi.mock('../lib/api', ...)` block.
- [x] 2.2 Swapped the corresponding named import.
- [x] 2.3 `beforeEach` now calls
      `vi.mocked(fetchExperimentDocs).mockResolvedValue({ experiments: [] })`.
- [x] 2.4 New test `renders experiment rows in
      effectiveUpdatedAt-descending order` added — mocks 3 exps with
      shuffled timestamps, asserts the rendered `<a href="/p/project-a/e/...">`
      order is `[B, C, A]` (newest first).
- [x] 2.5 Existing 2 tests still pass; full sidebar suite is 3/3 green.

## 3. Spec sync prep

- [x] 3.1 `openspec validate sidebar-exps-only-by-recency
      --type change` → valid.

## 4. Typecheck and test gate

- [x] 4.1 `pnpm --filter @memon/web typecheck` clean — no unused
      imports left from the deletion (`IndexedRun`, `fetchExperiments`,
      `StatusPill` all gone from the file).
- [x] 4.2 `pnpm vitest run components/app-sidebar` → 3/3 passing
      (2 existing + 1 new sort-order test).
- [x] 4.3 Full `pnpm --filter @memon/web test` → 267/267 passing
      (was 266 in last archive; +1 from the new sort-order test). No
      incidental breakage.

## 5. End-to-end verification (per CLAUDE.md F1)

- [x] 5.1 Killed old prod (pid 2359216), rebuilt web, started new
      prod (pid 2861032) on :3737. Warmup completed in 436ms,
      25 experiments indexed.
- [x] 5.2 Auth credentials read from `config.yml`.
- [x] 5.3 Verification path note: the sidebar is a TanStack Query
      client-rendered surface, so SSR HTML for `/p/project-a` does
      NOT contain the sidebar exp links (only the React shell). The
      F1-equivalent verification is a chain:
      (a) The served `/p/project-a` HTML contains 0 occurrences of
          `>Runs<` and 0 of `no runs` (confirms the deleted Runs
          sub-section + its placeholder are gone) — **verified**.
      (b) `GET /api/experiments?project=sparse-fsdp` returns exps
          with varied `effectiveUpdatedAt`; sorted desc, the top is
          `E0016-verl-fsdp2-forward-prefetch-fix` followed by E0015,
          E0014 etc. — this is the order the sidebar's `useMemo`
          will produce — **verified**.
      (c) Vitest `renders experiment rows in
          effectiveUpdatedAt-descending order` directly asserts the
          DOM-level sort behavior — **verified**.
- [x] 5.4 Sort key parity with `experiment-card-grid.tsx` is
      structural — both surfaces use the same one-line
      `b.effectiveUpdatedAt.localeCompare(a.effectiveUpdatedAt)`,
      so picking the same top exp is a property of the API response,
      not of either surface independently.
- [x] 5.5 CSS regression check: `--background` / `--foreground` /
      `--card` / `--muted` / `--primary` all present in the layout
      CSS bundle (`/_next/static/css/55a7580e5f070b1b.css`).
