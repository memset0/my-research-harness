## 1. Core types and enum extensions

- [x] 1.1 Extend `Status` union in `packages/core/src/types.ts` to include `INTERRUPTED`; update `STATUS_VALUES` and `STATUS_EMOJI` (add `INTERRUPTED: '⏸️'`).
- [x] 1.2 Update `normalizeStatus` in `packages/core/src/status.ts` to accept `INTERRUPTED` and lowercase `interrupted` (with parse warning).
- [x] 1.3 Add `ExperimentStatus` union (`'OPEN' | 'RESOLVED' | 'ABANDONED'`), `EXPERIMENT_STATUS_VALUES`, and `EXPERIMENT_STATUS_EMOJI` (`OPEN: '🔵'`, `RESOLVED: '✅'`, `ABANDONED: '⚫'`) to `packages/core/src/types.ts`.
- [x] 1.4 Add `normalizeExperimentStatus` to `packages/core/src/status.ts` mirroring `normalizeStatus` (lowercase normalisation with parse warning, out-of-enum defaults to `OPEN` with parse error).
- [x] 1.5 Add `status: ExperimentStatus` field to `ExperimentFrontMatter` interface in `packages/core/src/types.ts`.
- [x] 1.6 Add `archived: boolean` field to both `ExperimentFrontMatter` and `RunFrontMatter` interfaces in `packages/core/src/types.ts`.
- [x] 1.7 Unit tests in `packages/core/src/status.test.ts` cover all six run-status values and all three exp-status values, plus lowercase normalisation paths.

## 2. Parsers and serializers

- [x] 2.1 Update run README parser in `packages/core/src/readme/parse.ts` to read `archived` from frontmatter; emit `MISSING_ARCHIVED_FIELD` parse warning when missing; default to `false`.
- [x] 2.2 Update experiment-doc parser in `packages/core/src/readme/parse.ts` (or wherever the exp parser lives) to read `status` and `archived`; emit `MISSING_EXP_STATUS` and `MISSING_ARCHIVED_FIELD` parse warnings when missing; default to `OPEN` and `false` respectively.
- [x] 2.3 Update run README serializer to emit `archived: <bool>` in canonical key order (between `gpus` and `entry`).
- [x] 2.4 Update experiment-doc serializer to emit `status` (between `title` and `archived`) and `archived` (between `status` and `runs`) in canonical key order.
- [x] 2.5 Round-trip tests: parse → serialize a v4-shaped doc and assert byte-identical output.
- [x] 2.6 Round-trip test for a v3-shaped doc (no `status` / `archived`): parser surfaces warnings, serializer (when called with the parsed result) produces a v4-shaped doc with the defaulted values.

## 3. Status-set CLI: run side

- [x] 3.1 Verify `memon run status set --to <STATUS>` accepts `INTERRUPTED` as a valid value (no code change beyond passing through the widened enum); add a CLI test.
- [x] 3.2 In the run-status-set code path, after a successful write, if the on-disk pre-write `archived` was `true`, emit `warning: <id> is archived; modifying anyway` to stderr AND include `"warning":"archived"` in stdout JSON.

## 4. Status-set CLI: experiment side (new)

- [x] 4.1 Add a new `memon experiment status set <id> --to <ExperimentStatus> [--expected-mtime <ms>]` subcommand handler that operates on `docs/experiments/<id>.md` when `<id>` matches `EXPERIMENT_FILENAME_REGEX`.
- [x] 4.2 Wire the legacy `memon experiment status set <run-id>` form (when `<id>` matches `RUN_DIR_REGEX`) to dispatch to `memon run status set` with a `[deprecation]` banner on stderr (suppressible via `MEMON_QUIET_DEPRECATIONS=1`).
- [x] 4.3 In the exp-status-set code path, append a `[EXP_STATUS] \`<id>\` <FROM> → <TO>` event to JOURNAL.md when status changes (atomic with the doc rewrite).
- [x] 4.4 Apply the soft warning when the on-disk doc has `archived: true`.
- [x] 4.5 CLI tests for: (a) successful exp-status set, (b) noop when status unchanged (no JOURNAL event), (c) BAD_REQUEST on out-of-enum value, (d) deprecation banner on run-id form, (e) soft warning on archived target.

## 5. Archive subcommands rewired to frontmatter

- [x] 5.1 Replace `memon run archive <id>` implementation: instead of writing `<runDir>/.archived`, write `archived: true` into the run README frontmatter via the same atomic-write + mtime-lock + JOURNAL `[ARCHIVE]` flow used by status set; bump `updated_at`.
- [x] 5.2 Replace `memon run unarchive <id>` implementation: write `archived: false` into the run README frontmatter (skip the rewrite entirely if already `false`, returning `noop:true`).
- [x] 5.3 Add the hard rule: refuse `run archive <id>` when on-disk `status === 'RUNNING'` with exit 2 and the documented JSON error body.
- [x] 5.4 Apply the soft warning when archiving an already-archived run (do NOT emit the warning on unarchive).
- [x] 5.5 Add `memon experiment archive <exp-id>` and `memon experiment unarchive <exp-id>` to the exp CLI module (new functionality), writing `archived: true | false` into the exp doc's frontmatter; append `[ARCHIVE]` event with `op=archive | op=unarchive`.
- [x] 5.6 Update the legacy `memon experiment archive <run-id>` (run-id form) to deprecation-alias to `memon run archive`.
- [x] 5.7 Update the `[ARCHIVE]` event body grammar to use `\`<id>\` op=<archive|unarchive>` (new); remove any sidecar mention from the body.
- [x] 5.8 Tests: hard rule rejects archive-on-RUNNING for runs; soft warning for archived target; exp-side archive writes frontmatter; legacy CLI form emits deprecation banner.

## 6. Discovery and scan

- [x] 6.1 Update `discoverRuns` in `packages/core/src/discovery/discover.ts` to source `archived` from `frontMatter.archived` (the new field). Fall back to checking `<runDir>/.archived` ONLY when `frontMatter.archived` is missing entirely (use `parseWarnings.code === 'MISSING_ARCHIVED_FIELD'` as the detection).
- [x] 6.2 When falling back to the sidecar, surface `LEGACY_ARCHIVE_SIDECAR` parse warning on the run record.
- [x] 6.3 Update `discoverExperiments` to expose `archived` from `frontMatter.archived` (no sidecar fallback for exp side).
- [x] 6.4 Update `packages/core/src/cli/scan.ts` `RunSummary` shape so its `archived` field sources from frontmatter (not sidecar).
- [x] 6.5 Tests: archived-from-frontmatter, sidecar fallback only when field missing, frontmatter wins over sidecar in inconsistent state, parse warning surfaces in fallback case.

## 7. Doctor lints

- [x] 7.1 Add `INTERRUPTED_NO_NOTE` lint to `packages/core/src/cli/doctor.ts`: severity `info`, trigger `status === 'INTERRUPTED' && sections.result is empty`.
- [x] 7.2 Add `RESOLVED_NO_CONCLUSION` lint: severity `info`, trigger applies to exp docs `status === 'RESOLVED' && sections.conclusion is empty`.
- [x] 7.3 Verify `LEGACY_ARCHIVE_SIDECAR` parse warnings bubble through to `doctor` output (no new code likely needed; assert via test).
- [x] 7.4 Doctor tests for the two new lints + the parse-warning bubble.

## 8. Web API endpoints

- [x] 8.1 `apps/web/app/api/runs/[id]/readme/route.ts`: accept new fields in incoming body; apply hard `ARCHIVE_RUNNING_FORBIDDEN` rule (HTTP 422); apply soft warning on writes-to-archived (200 with `warning: 'archived'` in body).
- [x] 8.2 `apps/web/app/api/experiments/[id]/readme/route.ts`: same shape — accept `status` and `archived`; apply soft warning when on-disk `archived: true`; include `prevStatus` / `nextStatus` in response on status change.
- [x] 8.3 New POST handlers (or extension of existing readme route) for explicit archive toggles, mirroring the CLI semantics.
- [x] 8.4 API tests covering: archive-on-RUNNING refuse (422), status-and-archive transition that ends in non-RUNNING succeeds, soft-warning surfacing for both run and exp paths.

## 9. Web UI: status pills and color refresh

- [x] 9.1 Update `apps/web/components/status-pill.tsx` (or wherever the run status pill lives) with the six-value color/icon mapping from `web-layout/spec.md`'s delta.
- [x] 9.2 Add an `<ExperimentStatusPill>` component for the three-value `ExperimentStatus` enum.
- [x] 9.3 Add the archived overlay treatment (desaturated variant + Archive icon prefix) to both pills as a wrapper / variant prop.
- [x] 9.4 Update `apps/web/components/status-pill.tsx`'s inline `STATUS_EMOJI` shim (mentioned in CLAUDE.md as a client-safe inline copy) to include `INTERRUPTED: '⏸️'`.  *(N/A — no inline emoji shim exists in current web code; status-pill renders lucide icons exclusively.)*
- [x] 9.5 Verify CSS tokens for the new color shades (`amber-100/800`, `rose-50/900`, `stone-100/800`) are present in the compiled output per the verification protocol; if any token is missing, run shadcn add or extend `globals.css` accordingly.
- [x] 9.6 Visual sanity check via the verification protocol (curl the rendered HTML + the compiled CSS) for one page that renders all enum values.

## 10. Web UI: experiment-card grid refactor

- [x] 10.1 Update `apps/web/components/experiment-card-grid.tsx`: replace the aggregate-from-member-runs computation in the card pill with `exp.frontMatter.status`.
- [x] 10.2 Move the `<finished> / <total>` counter out of the header; add a secondary text line under the title with the run-roster summary (`<n> running · <n> done · <n> interrupted · <n> failed · <n> pending`) skipping zero-count categories.
- [x] 10.3 Apply the archived overlay treatment to cards whose exp is archived.
- [x] 10.4 Add the "Show archived" checkbox above the grid with per-project localStorage persistence.
- [x] 10.5 Implement the unchecked-mode listing: active items in the upper section, bottom-of-list `Show <N> archived experiments` reveal affordance, separate archived bucket on click.
- [x] 10.6 Implement the checked-mode listing: interleaved sort, bottom-of-list affordance hidden.
- [x] 10.7 Apply the same archived listing rules to the per-project sidebar run list (`apps/web/components/app-sidebar.tsx`) below the existing "View more" affordance.  *(Spec changed mid-apply per user: sidebar excludes archived items entirely instead of mirroring the grid's two-mode listing. Sidebar now filters out `archived: true` exps; no checkbox, no folded bucket. spec.md + design.md + proposal.md updated.)*
- [x] 10.8 Component tests for: card pill driven by manual status, secondary line shows correct counts, archived overlay renders, both checkbox modes, sort orders.

## 11. Web UI: status pickers in editors

- [x] 11.1 Update the run README editor's status `<Select>` (`apps/web/components/edit-markdown-button.tsx` or sibling) to include `INTERRUPTED` as a selectable option. Exclude `UNKNOWN` (parser-only).
- [x] 11.2 Add an exp-doc status `<Select>` with `OPEN` / `RESOLVED` / `ABANDONED`.
- [x] 11.3 Add an archive toggle (checkbox or switch) to both the run and exp editors. Wire its disabled state to the run-side hard rule (disable + tooltip "cannot archive a RUNNING run").
- [x] 11.4 On a successful write whose response includes `warning: 'archived'`, display a non-blocking sonner toast with the message text.
- [x] 11.5 Editor tests for the new pickers, archive toggle disabled state, and toast surfacing.

## 12. FS migration runtime + guide

- [x] 12.1 Implement the v3→v4 transform module in `packages/core/src/fs-version/...` with the exp-doc-walk and run-dir-walk per `fs-migration-runtime/spec.md`'s delta. Idempotent.
- [x] 12.2 Wire the transform into the existing `migrate-fs` runtime dispatch table.  *(`memon-migrate-fs` is an agent-driven skill that reads guides by name pattern from `packages/core/migrations/v<N>-to-v<N+1>.md`; the existing `v3-to-v4.md` guide is the wiring.)*
- [x] 12.3 Author `packages/core/migrations/v3-to-v4.md` per `fs-migration-guide-authoring/spec.md` (seven sections, exact commit message format, four canonical edge cases). Cover: status-enum widening forward-compat, archive sidecar→frontmatter migration, exp-side OPEN-fill.
- [x] 12.4 Migration runtime tests: idempotent re-run, mixed pre-states (some sidecars present, some absent, some exp docs already migrated), partial-failure recovery (sidecar deletion fails after README write).
- [x] 12.5 Verify the migration guide passes whatever validation tooling exists (e.g. `fs-migration-guide-authoring/spec.md`'s structural rules).  *(Hand-verified against meta-spec: 7 H2 sections in canonical order present; commit message format string included; 4 canonical edge cases addressed. No automated validator exists; same `## Setup` duplication inside YAML examples as the existing v2-to-v3.md guide.)*

## 13. FS_CONVENTION_VERSION bump

- [x] 13.1 Change `FS_CONVENTION_VERSION` from `3` to `4` in `packages/core/src/version.ts`. **Do this LAST** in the code-change sequence so partially-applied work doesn't advertise v4 prematurely.

## 14. Test corpus updates

- [x] 14.1 Update `packages/core/src/discovery/index.test.ts`, `read.test.ts`, `stale.test.ts` and any sibling tests that synthesise run frontmatter to include `archived: false` in the test fixtures.
- [x] 14.2 Update experiment fixtures in `packages/core/src/experiments/membership.test.ts` and similar to include `status: OPEN` and `archived: false`.
- [x] 14.3 Update mock data under `mock/` (if present) to include the new fields, OR ensure the parser-default path covers them and add a fixture-style test for the v3-mock case.  *(Updated 9 exp docs and 12 run READMEs in mock/ to canonical v4 shape with `status: OPEN` and `archived: false`.)*
- [x] 14.4 Run full test suite; ensure no orphan v3-shaped fixture causes failures.  *(229 core + 69 CLI + 258 web = 556 tests pass.)*

## 15. Verification (per CLAUDE.md F1/F4)

- [x] 15.1 `pnpm --filter @memon/core typecheck` passes.
- [x] 15.2 `pnpm --filter @memon/web typecheck` passes.
- [x] 15.3 Full prod build of web (`pnpm --filter @memon/web build`) passes; restart prod server per CLAUDE.md "Dev: prefer prod build" sequence.
- [x] 15.4 Read credentials from `config.yml`; curl `/p/<project>` and grep for the new pill class names + `Show <N> archived` text + the secondary line text. Both for an active and an archived exp card.
- [x] 15.5 Curl the compiled CSS and grep for `--background`, `--foreground`, plus the amber/rose/stone tokens used by the new pills; confirm they have oklch() values defined.
- [x] 15.6 Run `memon scan` against a project with v3 fixtures; confirm `archived` surfaces from frontmatter (or sidecar fallback with the warning), and `status` defaults work.
- [x] 15.7 Run `memon doctor` against fixtures including a `status: INTERRUPTED` run with empty Result + a `status: RESOLVED` exp with empty Conclusion; confirm both info-level lints fire.
- [x] 15.8 Manual smoke: open the editor on an archived run, change a body word, save; confirm the success toast carries the archived warning.
- [x] 15.9 Manual smoke: try to archive a RUNNING run via the web toggle; confirm 422 response and the toggle stays unchecked + error toast.
