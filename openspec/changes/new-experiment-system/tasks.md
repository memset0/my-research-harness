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

- [ ] 6.1 Add `memon experiment` parent command in `packages/cli/src/commands/`
- [ ] 6.2 Implement `memon experiment ls` (default JSON, `--format human`)
- [ ] 6.3 Implement `memon experiment show <id-or-slug>`
- [ ] 6.4 Implement `memon experiment create <slug>` per `experiment-edit` spec, including `--from-run`, `--title`, `--hypotheses`, `EEXIST` retry loop
- [ ] 6.5 Implement `memon experiment link <id> <run>` with bidirectional write and soft-prefix warning
- [ ] 6.6 Implement `memon experiment unlink <id> <run>` with bidirectional clear
- [ ] 6.7 Implement `memon experiment delete <id> [--force]` with cascade unlink and confirmation prompt
- [ ] 6.8 Implement `memon experiment warning {add|resolve|reopen|delete|list}` with `--run` attribution; reuse `experiment-readme`'s section-bound writer

## 7. CLI: run subcommands

- [ ] 7.1 Add `memon run` parent command
- [ ] 7.2 Move `memon experiment status set` → `memon run status set` (operates on run README)
- [ ] 7.3 Move `memon experiment readme write` → `memon run readme write`
- [ ] 7.4 Move `memon experiment archive` / `unarchive` → `memon run archive` / `unarchive`
- [ ] 7.5 Move `memon experiment journal read` (run-scoped queries) → `memon run journal read`
- [ ] 7.6 Implement `memon run rename <id> <new-slug>` per `run-edit` spec, including atomic update of parent exp's `runs[]`, `MISMATCH_EXPERIMENT_REF` block, soft-prefix warning, JOURNAL `[RENAME]` event
- [ ] 7.7 Add legacy-name shims: `memon experiment status set` etc. print deprecation to stderr and dispatch to `memon run *`
- [ ] 7.8 Update `memon list` to operate on runs (not experiments); update `memon search` to drop sub-project matching
- [ ] 7.9 Update `memon new <name>` template: emit v3 frontmatter (no `project:`, no `hypotheses:`, no `tags:`; include `created_at`, `updated_at`, empty `experiment:`)

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

- [ ] 10.1 Build `<ExperimentCard>` component: header (status pill, id+slug, runs counter, title), embedded `<RunsTable>`, footer (tags + effective times with icons)
- [ ] 10.2 Build `<OrphanRunCard>` component: greyed border, single-row table, `Link to experiment...` button
- [ ] 10.3 Build `<AnomalyBanner>` component: yellow card, count header, scrollable body, `Copy all` (formatted plaintext) + `Hide` (sessionStorage)
- [ ] 10.4 Replace the v2 list-page card-stack with the new card grid; route stays `/p/<project>` but internals are rebuilt
- [ ] 10.5 Wire `useExperiments` / `useAnomalies` queries to the new endpoints; subscribe to SSE topics for live updates
- [ ] 10.6 Remove sub-project badge component and any references; remove free-text search match against sub-project label
- [ ] 10.7 Sort/filter controls: sort by `effective_updated_at` (default), `effective_created_at`, `title`; search across title/slug/tags/run-names

## 11. Web frontend (experiment detail page)

- [ ] 11.1 Add route `/p/<project>/e/<E-id-slug>` (Next.js App Router page)
- [ ] 11.2 Build `<ExperimentHeader>`: title, aggregate status, effective times, tags, hypothesis-ref chips
- [ ] 11.3 Build exp-level action bar: `Edit markdown`, `Open Claude Code`
- [ ] 11.4 Render exp doc body sections (Motivation / Method / Conclusion / Caveats / Warnings) using the existing markdown renderer; warnings table rendered as interactive component (resolve/reopen/edit-note/add)
- [ ] 11.5 Build `<RunPanel>`: collapsible (default expanded), eager summary header, lazy-loaded body via `useRun(id)`, skeleton during load
- [ ] 11.6 Inside run panel: frontmatter table, Setup/Result/Artifacts rendered, auto file listing (from `/api/runs/:id/files`), log tail viewer
- [ ] 11.7 Run-panel action bar: `Edit markdown (run)`, `Open Claude Code (run)`, `Archive`
- [ ] 11.8 Implement panel expand-state persistence: URL hash + `localStorage['memon:exp-page:<exp-id>:expanded']`
- [ ] 11.9 Honor `?run=<run-dir>` query param: expand that panel + scroll into view
- [ ] 11.10 Wire SSE: `experiment-change`, `run-change` (for member runs), `anomaly` invalidations
- [ ] 11.11 Hardcode preset prompts in a constants module: exp-scoped and run-scoped (per design D15)

## 12. Web frontend (editor save handshake)

- [ ] 12.1 Update Monaco editor `onSave` handler to: (a) capture `now()` ISO+offset, (b) rewrite frontmatter `updated_at` in the buffer, (c) POST with `expectedMtime`+`expectedHash`, (d) on 200 replace buffer with response `finalContent` and store new mtime/hash, (e) on 409 roll back the `updated_at` bump and surface conflict UI
- [ ] 12.2 Apply the same handler to both the exp-doc editor and the run-readme editor surfaces (shared component, parameterized by API path)
- [ ] 12.3 Update localStorage draft keys to include the file path so drafts for exp docs vs run READMEs don't collide

## 13. Web frontend (URL redirects & layout)

- [ ] 13.1 Add Next.js redirect (or middleware) for `/p/<project>/r/<run-dir>` and `/p/<project>/experiments/<run-dir>` → resolve the run's parent exp via `/api/runs/<id>` and rewrite to `/p/<project>/e/<E-id>?run=<run-dir>`; for orphans, rewrite to `/p/<project>` with scroll-target hash
- [ ] 13.2 Update sidebar: list experiments per project (not runs); counter badge shows `# experiments`; remove "All Runs" entry if any
- [ ] 13.3 Update sidebar `localStorage` keys if needed (no breaking change to existing keys)
- [ ] 13.4 Add `Open Claude Code` button click handler that calls a backend route `POST /api/open-claude-code` with `{ projectRoot, presetPrompt }`; backend invokes the local Claude Code launcher (or returns an error if not installed)

## 14. Migration runtime + guide

- [ ] 14.1 Author `packages/core/migrations/v2-to-v3.md` per `fs-migration-guide-authoring` (seven sections: Background/Why, Detection, Diff, Target State, Verification, Rollback, Edge Cases)
- [ ] 14.2 In the guide, write the agent-led step list (1–9 from design D17): survey → cluster → confirm → generate exp docs → rewrite run READMEs → verify bidirectional binding → optional run rename → bump `.memon/version.json`
- [ ] 14.3 Include shell verification commands at the end of the guide that confirm: every exp file matches `E\d{4}-…\.md`; every run README has either valid `experiment:` or none; no run README contains the legacy sections; `.memon/version.json` reports `fs_convention_version: 3`
- [ ] 14.4 Document the four edge cases per `fs-migration-guide-authoring`: missing-file, custom-frontmatter, dirty-tree (delegated to runtime), concurrent-migration; plus v3-specific "single-run exp", "run motivation forks two investigations", "pre-existing docs/experiments/"
- [ ] 14.5 Verify the guide is consumable by `fs-migration-runtime` (no spec-level changes needed; runtime is generic)

## 15. Version bump and version.json plumbing

- [ ] 15.1 Update `packages/core/src/version.ts`: `FS_CONVENTION_VERSION = 3`
- [ ] 15.2 Update `memon install-skills` post-install marker logic to write `fs_convention_version: 3` for fresh installs (`fs-version-tracking` MODIFIED scenarios)
- [ ] 15.3 Update `memon fs-version check` Scenarios to test the v3 path
- [ ] 15.4 Update `memon-cli` exit-code dictionary tests: `MEMON_TOO_OLD` triggers when project is at v4+ (synthetic; current tools at v3)

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
