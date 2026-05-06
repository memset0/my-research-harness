## 1. Core types and ID infrastructure

- [x] 1.1 Add `'E'` to `ID_PREFIXES` in `packages/core/src/ids.ts`; update `IdPrefix` type and `ID_REGEX`
- [x] 1.2 Add `nextExperimentId(projectRoot)` and `resolveExperimentId(projectRoot, needle)` helpers in `packages/core/src/experiments/id.ts`; export from `index.ts`
- [x] 1.3 Per design D2: rename old `Experiment*` TS symbols (representing run dirs) to `Run*` across `packages/core/src`, `packages/cli/src`, `apps/web/` via word-boundary sed; then introduce new `Experiment{,FrontMatter,Sections,WarningRecord,EffectiveTimes,MembershipAnomaly,MembershipAnomalyCode}` types and `EXPERIMENT_FILENAME_REGEX` for the v3 experiment-doc concept; rebuild `packages/core/dist`; typecheck + unit-test gate between phases
- [x] 1.4 Extend `RunFrontMatter` (post-rename) with required `experiment: string | null` and `updatedAt: string` fields; legacy `project` / `hypotheses` / `tags` fields kept on the type with deprecation notes (parser stops reading on the v3 path); update all `RunFrontMatter` literal constructors (parser empty-result, dirname-synth fallback, test fixtures)
- [x] 1.5 Add `parseSlugFromRunDir(dirName)` and `parseTimestampFromRunDir(dirName)` helpers in `packages/core/src/time.ts`; export from `index.ts`
- [x] 1.6 Extend `RunFrontMatterRawSchema` with optional `experiment`, `updated_at`; add new `ExperimentFrontMatterRawSchema` for exp doc; both exported from `schemas.ts`

## 2. Mock data migration (manual)

- [ ] 2.1 Create `mock/project-a/docs/experiments/` and `mock/project-b/docs/experiments/` directories
- [ ] 2.2 Group `mock/project-a/logs/*` runs by motivation similarity and author 3–4 experiment docs (`E0001-…`, `E0002-…`, …) under `mock/project-a/docs/experiments/`; each carries Motivation/Method/Conclusion/Caveats/Warnings (with `Run` column populated) and proper `runs[]`/`hypotheses[]`/`tags[]` frontmatter
- [ ] 2.3 Group `mock/project-b/logs/*` runs similarly under `mock/project-b/docs/experiments/`
- [ ] 2.4 Strip `project:`, `hypotheses:`, `tags:` from every run README under both `mock/project-*/logs/*/`; add `experiment:` and `updated_at:` to each
- [ ] 2.5 Strip `Motivation`/`Method`/`Conclusion`/`Caveats`/`Warnings`/`New Hypotheses` body sections from every run README; keep only `Setup`/`Result`/`Artifacts`
- [ ] 2.6 Where existing run prose is too thin to support a coherent exp doc, fabricate motivation/method/conclusion text consistent with the run's setup/result (per design D22)
- [ ] 2.7 Update `mock/project-{a,b}/docs/hypotheses.md`: split each `**Experiments**:` field into `**Experiments**:` (E IDs) and `**Runs**:` (run dir names) where appropriate
- [ ] 2.8 Bump `mock/project-{a,b}/.memon/version.json` to `fs_convention_version: 3` and add `last_migrated_at` timestamp
- [ ] 2.9 Verify by hand: every member-run/exp pair satisfies bidirectional binding (run.experiment matches AND exp.runs contains)

## 3. Core parsers

- [x] 3.1 Implement `parseExperimentReadme(content, filenameStem): ParsedExperiment` in `packages/core/src/experiments/parse.ts` — frontmatter validation, filename ↔ id sanity, section split (Motivation / Method / Conclusion / Caveats / Warnings), legacy-section warnings (e.g. `New Hypotheses` in exp doc); plus `buildExperimentRecord(parsed, meta)` for the discovery layer
- [x] 3.2 Run readme parser stays at `packages/core/src/readme/parse.ts` (rename moved the type names to v3); v3 schema (`experiment:` / `updated_at:` accepted; legacy `project:` / `hypotheses:` / `tags:` accepted but ignored on the v3 path) integrated into the existing `parseReadme`
- [ ] 3.3 Default-fill logic in run parser: missing `created_at` → derive via `parseTimestampFromRunDir`; missing `updated_at` → equal `created_at` (partial — `synthesizeFromDirname` already derives, but the main `parseReadme` path with present-but-empty `created_at` should also derive)
- [ ] 3.4 Update warnings table parser to expect a `Run` column header; emit `WARNINGS_TABLE_HEADER_MISMATCH` for v2-shape tables
- [ ] 3.5 Add a `parseExperimentRefList` helper for the hypotheses field disambiguator (E IDs vs run dir names by regex)
- [ ] 3.6 Update `parseHypotheses` to also extract a `Runs:` field per entry; emit `MIGRATE_HYPOTHESIS_REFS` when run-dir names appear under `Experiments:`
- [ ] 3.7 Unit-test all parsers against the migrated `mock/` fixtures; ensure zero parse-errors and the expected parse-warnings are emitted

## 4. Core writers

- [x] 4.1 Implement `serializeExperimentReadme(input)` in `packages/core/src/experiments/serialize.ts` — frontmatter render + canonical section order (Motivation / Method / Conclusion / Caveats / Warnings); raw warnings markdown round-trips verbatim. Atomic disk-write wrapper (`writeExperimentReadme`) deferred to where it's first needed (`memon experiment create` / `PUT /api/experiments/:id/readme`)
- [ ] 4.2 Update run README serializer (`packages/core/src/readme/serialize.ts`) to emit `experiment:` and `updated_at:` lines on the v3 path, and drop `project:` / `hypotheses:` / `tags:` (the legacy fields stay readable but new writes don't emit them)
- [ ] 4.3 Implement section-bound writer for the experiment doc's `## Warnings` section (table with `Run` column)
- [ ] 4.4 Update `writeWarningRow` to accept an optional `run: string | null` and place it in the `Run` column

## 5. Discovery and indexing

- [x] 5.1 Existing run-discovery code lives at `packages/core/src/discovery/discover.ts` (sed renamed `discoverExperiments → discoverRuns` in the rename pass; not relocating to a new filename to keep diff minimal)
- [x] 5.2 Add `packages/core/src/experiments/discover.ts` (`discoverExperiments`, `readExperimentDoc`) scanning `docs/experiments/E<NNNN>-<slug>.md` per `experiment-discovery` spec
- [x] 5.3 Implement the membership join in `packages/core/src/experiments/membership.ts` (`computeMembership({ experiments, runs, project })`) producing `confirmedMembers[]` Map and the three anomaly classes (`ORPHAN_RUN`, `PHANTOM_RUN_REF`, `MISMATCH_EXPERIMENT_REF`)
- [ ] 5.4 Wire effective time computation (`effective_created_at`, `effective_updated_at`) into the experiment record at API serialization time
- [ ] 5.5 Surface `DUPLICATE_EXPERIMENT_SLUG`, `EXPERIMENT_SLUG_PREFIX_COLLISION`, `RUN_SLUG_PREFIX_VIOLATION`, `DUPLICATE_RUN_SLUG`, `LEGACY_SECTION_IN_RUN`, `LEGACY_NEW_HYPOTHESES_SECTION` warning codes (parser surfaces `INVALID_RUN_REF` / `INVALID_HYPOTHESIS_REF` / `legacy New Hypotheses section` already; the slug-uniqueness ones go on the project-level join)
- [ ] 5.6 Update poll loop to include `docs/experiments/` directory mtime tracking; ensure mtime advance on either side triggers anomaly recompute for the affected experiment(s)

## 6. CLI: experiment subcommands

- [x] 6.1 Add `memon experiment` parent command rewired to v3 exp-doc semantics in `packages/cli/src/index.ts`
- [x] 6.2 Implement `memon experiment ls` (default JSON, `--format human`) in `packages/cli/src/commands/experiment-doc.ts`
- [x] 6.3 Implement `memon experiment show <id-or-slug>`
- [x] 6.4 Implement `memon experiment create <slug>` per `experiment-edit` spec, including `--from-run`, `--title`, `--hypotheses`, `EEXIST` retry loop, `EXPERIMENT_SLUG_PREFIX_COLLISION` + `DUPLICATE_EXPERIMENT_SLUG` checks, JOURNAL `[EXPERIMENT] op=create` + (when `--from-run`) `[BIND] op=link`
- [x] 6.5 Implement `memon experiment link <id> <run>` with bidirectional write, soft-prefix `RUN_SLUG_PREFIX_VIOLATION` warning, JOURNAL `[BIND] op=link`
- [x] 6.6 Implement `memon experiment unlink <id> <run>` with bidirectional clear, JOURNAL `[BIND] op=unlink`
- [x] 6.7 Implement `memon experiment delete <id> [--force]` with cascade unlink (refuses without `--force` when bound runs exist), JOURNAL `[EXPERIMENT] op=delete`
- [ ] 6.8 Implement `memon experiment warning {add|resolve|reopen|delete|list}` with `--run` attribution against the exp doc's `## Warnings` table — DEFERRED until task 4.3 (section-bound writer for exp Warnings) lands

## 7. CLI: run subcommands

- [x] 7.1 Add `memon run` parent command in `packages/cli/src/index.ts`
- [x] 7.2 Add `memon run status set <id>` (re-uses `runStatusSet`)
- [x] 7.3 Add `memon run readme write <id>` (re-uses `runReadmeWrite`)
- [x] 7.4 Add `memon run archive <id>` / `memon run unarchive <id>` (re-uses `runArchive` / `runUnarchive`); legacy `memon experiment archive` etc. preserved as v2 aliases (no deprecation banner yet)
- [ ] 7.5 Add `memon run journal read` alias of `memon journal read` — DEFERRED (low value, can do during Slice F polish)
- [x] 7.6 Implement `memon run rename <id> <new-slug>` in `packages/cli/src/commands/run-rename.ts` per `run-edit` spec, including atomic dir rename, parent exp `runs[]` update, MISMATCH refusal, soft-prefix warning, `DUPLICATE_RUN_SLUG` check, JOURNAL `[RENAME]` event
- [ ] 7.7 Add deprecation banner to legacy `memon experiment status set` / `readme write` / `archive` / `unarchive` — DEFERRED (current behaviour: legacy names continue to work silently as v2 aliases)
- [ ] 7.8 Update `memon list` to drop sub-project search match — DEFERRED (sed already removed sub-project from frontmatter type; `memon search` defaults still match against body which is fine)
- [ ] 7.9 Update `memon new <name>` run-readme template to emit v3 frontmatter (drop `project:`/`hypotheses:`/`tags:`, add empty `experiment:`/`updated_at:`) — DEFERRED (the existing template still produces parseable v3 output since legacy fields are tolerated)

## 8. CLI: doctor and journal updates

- [ ] 8.1 Add `RUN_SLUG_PREFIX_VIOLATION` (severity `info`), `ORPHAN_RUN` (severity `warn`), `PHANTOM_RUN_REF` (severity `warn`), `MISMATCH_EXPERIMENT_REF` (severity `error`), `EXPERIMENT_SLUG_PREFIX_COLLISION` (severity `error`) to `memon doctor`'s rule set
- [ ] 8.2 Update `memon journal append` to accept `[EXPERIMENT]`, `[BIND]`, `[RENAME]` tags; reject `[STATUS]` (already enforced)
- [ ] 8.3 Update `[WARNING]` event emitter to include the `run=` token

## 9. Web backend (API routes)

- [ ] 9.1 Rename existing `/api/experiments` route to `/api/runs` (returns the run list/detail)
- [ ] 9.2 Add new `/api/experiments` route that returns experiment doc list/detail (with `effective_*` times computed)
- [ ] 9.3 Add `GET /api/experiments/:id` returning exp doc + summary rows for each member run (status, times, host, files-count)
- [ ] 9.4 Add `GET /api/runs/:id` returning full run detail (frontmatter + sections + auto-listed files + log paths)
- [ ] 9.5 Add `PUT /api/experiments/:id/readme` with optimistic mtime + content-hash lock; emit `[EXPERIMENT] op=edit` JOURNAL event on success
- [ ] 9.6 Add `PUT /api/runs/:id/readme` (replacing the v2 `/api/readme` for runs); emit `[STATUS]` event when the status field changed
- [ ] 9.7 Add `POST/PATCH/DELETE /api/experiments/:id/warnings[/:rowId]` per `experiment-edit`; accept optional `run` field on POST
- [ ] 9.8 Add `POST /api/experiments` (web equivalent of `memon experiment create`) accepting `{slug, title, hypotheses?, tags?, fromRun?}`
- [ ] 9.9 Add `POST /api/experiments/:id/link` and `:id/unlink` accepting `{ run }`
- [ ] 9.10 Add `DELETE /api/experiments/:id` (cascade-unlink with `?force=true`)
- [ ] 9.11 Add `GET /api/anomalies?project=<name>` and `GET /api/experiments/:id/anomalies`
- [ ] 9.12 Add `GET /api/runs/:id/files?depth=3` returning a tree of files under the run dir (cap at 200 entries)
- [ ] 9.13 Extend SSE `/api/events` with new topics `experiment-change`, `anomaly`, and `run-change`; keep legacy `experiment-change` (run edits) as deprecated alias for one window

## 10. Web frontend (list page)

- [x] 10.1 Build `<ExperimentCard>` component (inline in `experiment-card-grid.tsx`): aggregate-status pill, exp id, runs counter, title, embedded compact runs table, tags + effective times footer
- [x] 10.2 Build `<OrphanCard>` component (inline in `experiment-card-grid.tsx`): greyed dashed border, single-row, hint to bind via CLI
- [x] 10.3 Build `<AnomalyBanner>` component: yellow card pinned above the grid, count header, scrollable list, `Copy all` writes a plain-text report to the clipboard (`Anomalies from project X at <ISO>: …`), `Hide` button persists per-project in `sessionStorage`
- [x] 10.4 Replace the v2 list page (`/p/<project>/page.tsx`) with the new card grid using `<ExperimentCardGrid>`
- [x] 10.5 Wire `useQuery` for experiments + runs + anomalies to the v3 endpoints; SSE topic invalidation deferred (10.5 partial)
- [x] 10.6 Sub-project label is no longer shown anywhere on the new cards (the card design simply doesn't render it; legacy v2 components untouched)
- [ ] 10.7 Sort/filter controls beyond default `effective_updated_at desc` — DEFERRED (basic sort done)

## 11. Web frontend (experiment detail page)

- [x] 11.1 Add route `/p/<project>/e/<id>` (`apps/web/app/p/[project]/e/[id]/page.tsx`)
- [x] 11.2 Build `<ExperimentPage>` header: id + title + tags + hypothesis-ref chips
- [ ] 11.3 Exp-level action bar (`Edit markdown`, `Open Claude Code`) — DEFERRED to next polish pass
- [x] 11.4 Render exp doc body sections (Motivation / Method / Conclusion / Caveats / Warnings) via the existing `<Markdown>` renderer; Warnings rendered as raw markdown for now (interactive table mutation is task 6.8 / 4.3, deferred)
- [x] 11.5 Build `<RunPanel>` as `<details>`: eager-render summary row from /api/experiments/:id; lazy-fetch body via `fetchExperiment(runId)` + `fetchRunFiles(runId)` on first expand
- [x] 11.6 Run panel body: frontmatter command line, Setup, Result, Artifacts (described), automatic file listing (depth=3, capped at 200)
- [ ] 11.7 Run-panel action bar (`Edit markdown (run)`, `Open Claude Code (run)`, `Archive`) — DEFERRED; legacy "Open run page" link kept as escape hatch
- [x] 11.8 Panel expand state persists per-(exp, run) under `localStorage['memon:exp-page:<exp>:<run>:open']`
- [x] 11.9 Honor `?run=<run-dir>` query param: that panel auto-expands on initial render
- [ ] 11.10 SSE topic wiring (`experiment-change`, `run-change`, `anomaly` invalidations) — DEFERRED
- [ ] 11.11 Hardcoded preset prompts module for `Open Claude Code` — DEFERRED with action bar

## 12. Web frontend (editor save handshake)

- [ ] 12.1 Update Monaco editor `onSave` handler to bump `updated_at` in the editor buffer + refresh editor with response `finalContent` — DEFERRED
- [ ] 12.2 Apply the same handler to exp-doc + run-README editors — DEFERRED
- [ ] 12.3 localStorage draft keys updated to disambiguate exp vs run paths — DEFERRED

## 13. Web frontend (URL redirects & layout)

- [x] 13.1 Add Next.js redirect at `/p/<project>/r/<run-dir>/page.tsx` that resolves the run's parent exp via runtime and `permanentRedirect`s to `/p/<project>/e/<exp-id>?run=<run-dir>`; orphan runs redirect to `/p/<project>`
- [ ] 13.2 Update sidebar (`app-sidebar.tsx`) to list experiments — DEFERRED (sidebar still shows runs from /api/runs; v2 sidebar continues to function)
- [ ] 13.3 Sidebar localStorage key naming — n/a
- [ ] 13.4 `Open Claude Code` button + backend route `POST /api/open-claude-code` — DEFERRED with action bar

## 14. Migration runtime + guide

- [x] 14.1 Author `packages/core/migrations/v2-to-v3.md` per `fs-migration-guide-authoring`'s 7-section structure
- [x] 14.2 Embed the agent-led step list (per design D17): survey → cluster → confirm → generate exp docs → rewrite run READMEs → verify bidirectional binding → optional run rename → bump version marker — implicit in the Background and Diff sections; the Verification block is the runnable end gate
- [x] 14.3 Verification commands cover: legacy frontmatter fields gone from runs, every run's `experiment:` field matches `E<NNNN>-<slug>` (or null), at least one exp doc exists, exp doc filenames match the regex, hypotheses split applied, `.memon/version.json` advanced to 3 with non-null `last_migrated_at`
- [x] 14.4 Edge Cases section: single-run exp, run motivation forks two investigations, pre-existing `docs/experiments/`, run with no Motivation/Method/Conclusion, user-added custom frontmatter fields, dirty tree (delegated), concurrent migration, no hypotheses file, skill content still v2-shaped
- [x] 14.5 Guide is consumable by `fs-migration-runtime` (no runtime spec change required)

## 15. Version bump and version.json plumbing

- [x] 15.1 `packages/core/src/version.ts`: `FS_CONVENTION_VERSION = 3`
- [x] 15.2 `memon install-skills` reads `FS_CONVENTION_VERSION` and writes the bumped value automatically (existing code, no changes needed)
- [x] 15.3 `memon fs-version check` reports the v3 state by default since it reads the bumped constant
- [ ] 15.4 Refresh test scenarios that hardcode `fs_convention_version: 2` to use 3 where they're testing match-against-current-tool — DEFERRED (the existing tests use literal 2 as an arbitrary value, not as `FS_CONVENTION_VERSION`; they continue to pass since read/write is value-agnostic)

## 16. Tests

- [ ] 16.1 Add unit tests for `nextExperimentId`, the new parsers, and the membership-join algorithm
- [ ] 16.2 Add integration tests against `mock/project-a` and `mock/project-b` covering the full read flow (CLI list/show, web GET endpoints)
- [ ] 16.3 Add a snapshot regression test for the v2→v3 migration: take a copy of `mock/` reverted to v2 layout, walk the migration guide manually, assert the result matches the migrated `mock/` byte-for-byte (modulo timestamps)
- [ ] 16.4 Add Playwright/component tests for: list page card grid, anomaly banner copy-all, exp detail page run-panel expand persistence, redirect from `/r/<run>` to `/e/<exp>?run=<run>`
- [ ] 16.5 Update existing `experiment-*` test files to reference the new structure (rename to `run-*` where they tested run-side semantics)

## 17. Documentation and final verification

- [ ] 17.1 Update `CLAUDE.md` to mention the v2→v3 migration timing, the new directory layout (`docs/experiments/E*.md`), the new `Edit markdown` button locations, and the new CLI surfaces
- [ ] 17.2 Update repo `README.md` (if it documents the file model) to describe experiments + runs
- [ ] 17.3 Run the full verification protocol from `CLAUDE.md`: typecheck both packages and the web app; serve the dashboard; fetch and grep both list and detail pages for the expected markup; fetch the compiled CSS and confirm tokens are defined
- [ ] 17.4 Walk a fresh `memon serve` on the migrated `mock/project-a` end to end (exp list grid renders, click into an exp, run panels expand, edit run README, anomaly banner empty state, etc.)
- [ ] 17.5 `openspec validate new-experiment-system --type change` clean
