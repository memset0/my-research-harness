## Why

The archived change `2026-05-06-new-experiment-system` shipped the v3
file model with a sizable list of deferred items (warnings v3 通路, edit
endpoints, action bars, SSE topics, sidebar, effective times, parser
polish, doctor rules). Slices α–ζ implemented these post-archive in six
commits on `main`. That work is in production but the canonical specs
(`openspec/specs/*/spec.md`) and the test suite haven't fully caught up:

1. Four points in the running code disagree with the canonical specs —
   they were pragmatic choices made during the rush to ship the deferred
   slices, but the disagreement now means the contract is ambiguous.
2. The deferred test items (16.2 integration, 16.3 migration regression,
   16.4 Playwright) never landed; the only safety net for the v3 surface
   right now is the unit suite + a manual prod-build verification walk.
3. `CLAUDE.md` and the cosmetic test-file naming still describe the v2
   model.

This change closes both gaps: re-aligns code ↔ spec on the four mismatches,
adds the missing test layers, and updates the agent-facing docs.

## What Changes

### Code ↔ Spec realignment (4 decisions captured)

- **BREAKING (SSE)**: rename the v3 exp-doc topic
  `experiment-doc-change` → `experiment-change` to match
  `live-updates/spec.md`. The legacy `experiment-change` alias for run
  edits is dropped; new clients SHALL subscribe to `run-change` for run
  edits. Any client still on the legacy alias receives exp-doc events
  with the wrong shape and SHOULD update.
- **BREAKING (TanStack query keys)**: rename `['experiments']` →
  `['runs']` and `['experiment', id]` → `['run', id]` for run-side
  caches; the v3 exp-doc caches keep `['experiments']` /
  `['experiment', id]`. ~15–20 callsites in `apps/web/`. Also update
  the SSE invalidation map in `useMemonEvents()` accordingly.
- **Spec MODIFY (anomaly payload)**: keep the running code's
  `{ project, count }` shape; update `live-updates/spec.md` to remove
  the per-anomaly `{ op, record }` form. Trade-off documented in
  design.md — simplicity won; UI re-fetches the project anomaly list
  on each event rather than incremental-updating a banner row.
- **Spec MODIFY (warnings v2 6-col back-compat)**: keep the running
  code's lossless parse of v2 6-col tables (`run: null`); update
  `experiment-readme/spec.md` to permit this form. The
  `WARNINGS_TABLE_HEADER_MISMATCH` rejection path is dropped — readers
  tolerate v2; writers always emit v3 7-col so projects upgrade
  on first write.

### Tests (deferred from 16.x)

- **16.2** Integration tests against `mock/project-{a,b}` covering the
  full read flow: CLI `list` / `show` / `experiment ls` / `experiment
  show` + web GET `/api/experiments`, `/api/experiments/:id`,
  `/api/runs`, `/api/runs/:id`, `/api/anomalies`. Run via vitest with
  the API route handlers invoked directly (no live server).
- **16.3** v2→v3 migration regression: a hand-written v2 fixture under
  `packages/core/test-fixtures/v2-mock/`; the test walks the
  `packages/core/migrations/v2-to-v3.md` recipe and asserts the result
  matches `mock/project-a/` byte-for-byte (timestamps modulo).
- **16.4** Browser-level tests: list grid renders, anomaly banner
  copy-all, run-panel expand persistence, `/r/<run>` redirect to
  `/e/<exp>?run=<run>`. Use vitest + @testing-library/react where
  possible; only fall back to Playwright if a flow genuinely needs a
  real browser (we want to keep CI lean).

### Cosmetic + docs

- **16.5** Rename `apps/web/components/experiment-page.tsx` →
  `apps/web/components/exp-doc-page.tsx` (it renders the v3 exp doc,
  not a "v2 experiment"); rename run-side test files
  (`apps/web/components/edit-readme-button.test.tsx` is run-side OK as
  is) to drop the v2 lingo where it survived. Avoid touching anything
  the user doesn't see — purely an internal name cleanup.
- **17.1** Update `CLAUDE.md` to mention: the v3 file model
  (`docs/experiments/E*.md`) and run dirs as separate units; the new
  action-bar button locations (`Edit markdown`, `Open Claude Code`);
  the new CLI subcommands (`memon experiment {ls,show,create,link,
  unlink,delete}`, `memon run rename`); the new `/api/experiments/*`,
  `/api/runs/:id/readme`, `/api/open-claude-code` web endpoints.

## Capabilities

### New Capabilities

- _(none)_ — all behaviour already lives in existing capabilities.

### Modified Capabilities

- `live-updates` — SSE topic semantics (drop `experiment-change` →
  `run-change` alias; rename v3 exp-doc topic
  `experiment-doc-change` → `experiment-change`); revise the
  `useMemonEvents()` query-key invalidation map (`['runs']` instead of
  `['experiments']` for run-side); revise the `anomaly` payload shape
  to `{ project, count }`.
- `experiment-readme` — permit back-compat parse of v2 6-col warnings
  tables as `run: null`; drop the `WARNINGS_TABLE_HEADER_MISMATCH`
  rejection scenario.
- `test-suite` — add integration / migration regression / browser
  scenarios per 16.2 / 16.3 / 16.4.

## Impact

- **apps/web**: SSE topic rename in `app/api/events/route.ts` +
  `lib/events-client.ts`; query-key rename across ~15–20 files
  (`useQuery` / `invalidateQueries` / `prefetchQuery`); component
  rename `experiment-page.tsx` → `exp-doc-page.tsx` and its imports
  (`app/p/[project]/e/[id]/page.tsx`, plus 1 redirect target).
- **packages/core**: no behaviour change; specs in `openspec/specs/`
  modified to permit v2 6-col back-compat (already in code).
- **tests**: ~3 new test files in `apps/web/test/integration/`,
  ~1 fixture + 1 test in `packages/core/test/migration-v2-to-v3/`,
  ~2 browser scenarios in `apps/web/test/browser/`.
- **docs**: `CLAUDE.md` v3 sections; `README.md` already updated in
  Slice ζ (no further repo README work needed).
