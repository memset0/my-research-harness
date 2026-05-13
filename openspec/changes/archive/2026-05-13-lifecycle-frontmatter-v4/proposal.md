## Why

Three related gaps in the current lifecycle-metadata model surfaced in day-to-day use:

1. **Run status cannot express "a human stopped this mid-flight."** Today such cases collapse onto `FAILED`, which is misleading: `FAILED` should mean the program itself errored (anything inferrable from `run.log`), not "a human pressed stop." Mixing the two makes the dashboard's red badges noisy and makes follow-up triage ambiguous ("was this a code bug or did I kill it on purpose?").
2. **Experiment has no manual status.** The card pill is purely derived from member-run aggregation; the user has no way to declare "this investigation reached its motivation" or "we set this aside without a clean answer." The investigation lifecycle and the most-recent-run runtime state are different signals; collapsing them onto run-only aggregation hides the former.
3. **Archive state is split-brain across mechanisms.** Run dirs use a hidden `<runDir>/.archived` sidecar file; experiment docs have **no** archive concept at all (the v2-named "experiment archive" command actually archives a run dir, since v2 conflated experiment with run). The sidecar is invisible in normal git diffs (dot-files often filtered), bypasses the README's mtime-lock concurrency story, and forces every reader to issue a separate `stat()`. There is no way to archive an experiment as a whole.

This change unifies these as **human-managed lifecycle frontmatter** on both run READMEs and experiment docs, and bumps `FS_CONVENTION_VERSION` from 3 to 4 to carry the schema shift.

- Add `INTERRUPTED` to the run status enum, written **only on explicit human action** (never inferred from logs).
- Add an `ExperimentStatus` enum (`OPEN` / `RESOLVED` / `ABANDONED`) stored as a new required `status` field on the experiment-doc frontmatter, default `OPEN`. Same human-only write semantics.
- Migrate run-side archive from the `<runDir>/.archived` sidecar to a frontmatter `archived: bool` field on the run README. Add the equivalent `archived: bool` field to the experiment-doc frontmatter (new). Both default `false`. Same human-only write rule.
- Add a hard constraint: the archive-write path SHALL refuse to set `archived: true` on a run whose `status === 'RUNNING'`. (No analogous run-status constraint exists for unarchive, or for any exp-status / archive combination — only the "cannot archive a running run" rule.)
- Add a soft warning: write/edit commands operating on a run or exp that is `archived: true` SHALL still succeed but emit a warning on stdout/stderr (and in the web UI) so the user knows they're touching archived material on purpose.

The same change refreshes the UI color palette so the six run statuses, the three experiment statuses, and the archived-vs-active visual treatment are all distinct.

## What Changes

### Run status

- **BREAKING** Add `INTERRUPTED` to the canonical run status enum. New enum order: `PENDING` / `RUNNING` / `FINISHED` / `INTERRUPTED` / `FAILED` / `UNKNOWN`.
- **BREAKING semantics** Re-specify `FAILED` to exclude human-induced stops; those move to `INTERRUPTED`. `UNKNOWN` is reserved exclusively for "parser couldn't determine" (unchanged).
- New rule: `INTERRUPTED` MUST NOT be set automatically from log analysis. Only set via explicit user action through CLI / Web UI / README edit.
- Add `INTERRUPTED` to journal `[STATUS]` event parsing/serialization. Stale-RUNNING detection is unchanged (still based on mtime + `RUNNING`).
- Add an `INTERRUPTED_NO_NOTE` doctor lint (info-level): when `status === 'INTERRUPTED'` and `sections.result` is empty, prompt the user to document why the run was stopped.

### Experiment status (new field)

- **BREAKING** Add a `status` field to `ExperimentFrontMatter` with enum `OPEN` / `RESOLVED` / `ABANDONED` (`ExperimentStatus`).
  - `OPEN` (default) — the investigation is in progress; not necessarily "currently running," but the human has not declared it done.
  - `RESOLVED` — the investigation reached its motivation (positive close).
  - `ABANDONED` — the investigation closed without reaching its motivation (no clean answer, dropped in favor of a different approach, etc.).
- Same human-only semantic as `INTERRUPTED`: `ExperimentStatus` is **never** auto-derived from member runs; only the user (or an agent acting on user instruction) writes it. Run-aggregation now informs only secondary detail UI (see "Card display" below), not the primary card pill.
- Default for every existing experiment doc on disk is `OPEN`. The v3→v4 migration writes `status: OPEN` into every `docs/experiments/E*.md` frontmatter that lacks the field.
- Default for every newly-created experiment doc (CLI `memon experiment create`, web `POST /api/experiments`) is `OPEN`.

### Archive moves to frontmatter (new for exp; migrated for run)

- **BREAKING** Add `archived: boolean` field to **run README** frontmatter. Default `false`. Replaces the legacy `<runDir>/.archived` sidecar file.
- **BREAKING** Add `archived: boolean` field to **experiment-doc** frontmatter. Default `false`. New capability — v3 had no exp-side archive.
- v3→v4 migration: for each existing run dir, if `<runDir>/.archived` is present, write `archived: true` into the run README frontmatter and delete the sidecar; if absent, write `archived: false`. For each existing experiment doc, write `archived: false` (since no v3 mechanism existed).
- **Hard rule**: the archive-write path SHALL refuse `archived: true` on a run whose `status === 'RUNNING'` and exit with `BAD_REQUEST` (CLI) / 422 (web). No analogous constraint exists for unarchive or for exp-status/archive interaction.
- **Soft rule**: any subsequent write that targets an `archived: true` run or exp (including status-set, README rewrite, warning add/resolve, link/unlink) SHALL succeed AND emit a warning on stderr (CLI) / surface a non-blocking toast (web) reading roughly: `warning: <id> is archived; modifying anyway`. Reads are silent.
- **Manual-only**: archive state is human-set. The orchestrating agent and the discovery/scan codepath SHALL NOT write `archived` on their own (parallel to the `INTERRUPTED` and `ExperimentStatus` rules).
- The legacy CLI `memon run archive` / `memon run unarchive` (and v2-aliased `memon experiment archive` / `unarchive`) are kept as commands but rewired to write the frontmatter field (with mtime-lock + JOURNAL `[ARCHIVE]` event) instead of toggling the sidecar.

### Card display

- Experiment-card pill changes from "aggregate of member-run statuses" to "the experiment's manual `ExperimentStatus`." `archived: true` exps render with a desaturated badge variant + an inline `Archive` icon (lucide).
- Member-run runtime state moves to a small **secondary line** under the title (e.g. `2 running · 5 done · 1 interrupted`), so a glance still surfaces "is anything in flight here?" without confusing it with the investigation status.
- The old aggregation rule (`RUNNING > FAILED > PENDING > FINISHED`) is removed from the card pill. It still exists as a derived stat for the secondary line and for the agent-handoff prompt.

### Frontend listing of archived items

The experiment-card grid (`/p/<project>`) SHALL surface a single "Show archived" checkbox above the listing, defaulting to **unchecked**. The two states have visibly different ordering:

- **Unchecked (default)**: Active items render in the upper section sorted by the existing rule (e.g. `effective_updated_at` desc for the exp grid). At the bottom of the listing, a single line `Show <N> archived` (where `<N>` is the count of archived items, with singular/plural agreement) reveals the archived bucket on click. When revealed (still without ticking the checkbox), the archived items render as a SEPARATE section below the active section, also sorted by the same rule but disjoint from the active list.
- **Checked**: Archived and active items are interleaved in a single sorted list — same sort key as above, no segregation. Archived items remain visually distinguishable via the desaturated treatment described under "Archive moves to frontmatter." The bottom-of-list "Show N archived" affordance is hidden in this mode.

The checkbox state SHALL persist per-project in client-side storage.

The per-project sidebar (`apps/web/components/app-sidebar.tsx`) SHALL exclude archived experiments entirely — no checkbox, no folded bucket. Sidebar is a quick-jump nav, not an exhaustive listing; archived items would only add noise. Users find archived experiments by going to the main grid and ticking "Show archived" or revealing the bottom-of-list bucket.

### FS convention bump

- Bump `FS_CONVENTION_VERSION` from `3` to `4`.
- v3→v4 migration:
  1. Walk `docs/experiments/E*.md`: insert `status: OPEN` and `archived: false` if missing; preserve user-set values; bump `updated_at` only when a real edit occurred.
  2. Walk run dirs: for each `<runDir>` containing `README.md`, insert `archived: <derived>` into frontmatter where `<derived>` is `true` iff `<runDir>/.archived` exists; bump `updated_at` only when changed; delete `<runDir>/.archived` if it existed (after the README write succeeds).
  3. Stamp `.memon/version.json` to `fs_convention_version: 4` after both walks succeed.
- Author migration guide `packages/core/migrations/v3-to-v4.md` per `fs-migration-guide-authoring/spec.md`. The guide documents the OPEN-fill, the archive-sidecar-to-frontmatter migration, the run-status enum extension (forward-compat: v3 readers see `INTERRUPTED` as `UNKNOWN` with a parse warning), and the four canonical edge cases.

### UI color palette refresh

Run-status badges across the dashboard:
- `PENDING` → neutral gray
- `RUNNING` → blue (was green)
- `FINISHED` → green (was the universal "✅" without a distinct color)
- `INTERRUPTED` → yellow / amber (new)
- `FAILED` → red
- `UNKNOWN` → muted red / red-gray (distinct from `FAILED`)

Experiment-status badges:
- `OPEN` → blue (matches "in progress, work continues")
- `RESOLVED` → green
- `ABANDONED` → muted gray-red

Archive treatment (orthogonal to status):
- An `archived: true` run or exp SHALL render its status pill with a desaturated background + an inline lucide `Archive` icon prefix. Card-level treatment: a subtle border-color shift + reduced opacity to telegraph "this is archived" at a glance.

## Capabilities

### New Capabilities

- `archive-frontmatter`: the canonical archive mechanism for both runs and experiment docs. Owns the `archived: bool` field semantics, the human-only write rule, the `cannot-archive-RUNNING-run` constraint, the soft warning on writes targeting archived items, the legacy sidecar deprecation, and the front-end listing rules (checkbox + two display modes).

### Modified Capabilities

- `run-readme`: status enum gains `INTERRUPTED`; `FAILED` semantic narrowed; `UNKNOWN` clarified as parser-only; references `archive-frontmatter` for the new `archived: bool` field.
- `experiment-readme`: legacy enum-table extended; new required `status: ExperimentStatus` frontmatter field; references `archive-frontmatter` for the new `archived: bool` field.
- `run-edit`: CLI `memon run status set` accepts `INTERRUPTED`; web `PUT /api/runs/:id/readme` accepts the new fields and emits the soft warning per `archive-frontmatter`.
- `experiment-edit`: new CLI `memon experiment status set <exp>` command; web `PUT /api/experiments/:id/readme` accepts new fields and emits the soft warning per `archive-frontmatter`.
- `memon-cli`: `memon run status set` flag widened; new `memon experiment status set`; `memon doctor` lint set updated; archive subcommands (run + exp) now write frontmatter via `archive-frontmatter`; `--include-archived` semantics updated to read the frontmatter field.
- `web-layout`: status-pill color and lucide-icon mapping for the six-value run enum and the three-value exp enum; archive-treatment overlay (icon + desaturation).
- `web-dashboard`: experiment-card pill source = manual `ExperimentStatus`; member-run aggregation drops to a secondary line; archive listing rules cross-reference `archive-frontmatter`.
- `journal`: `[STATUS]` event accepts `INTERRUPTED` as both `from` and `to`; new `[EXP_STATUS]` event for exp-status transitions; `[ARCHIVE]` event payload references the frontmatter-driven write (no sidecar mention); JOURNAL append happens atomically with the README mtime-locked write.
- `run-discovery`: archived detection sources from `frontMatter.archived` instead of `<runDir>/.archived`; sidecar fallback is constrained per `archive-frontmatter`'s rules.
- `fs-version-tracking`: bump constant from `3` to `4`; document the bump rationale.
- `fs-migration-runtime`: v3→v4 migration walks both exp docs and run dirs as described above; sidecar deletion is a post-migration cleanup step, gated on a successful README write.

## Impact

- **Code (run-status side)**:
  - `packages/core/src/types.ts`: `Status` union, `STATUS_VALUES`, `STATUS_EMOJI` gain `INTERRUPTED`; `RunFrontMatter` gains `archived: boolean`
  - `packages/core/src/status.ts`: `normalizeStatus` accepts `INTERRUPTED`
  - `packages/core/src/journal/parse.ts` / `serialize`: accept new value in `[STATUS]` lines; new `[EXP_STATUS]` tag
  - `packages/core/src/cli/doctor.ts`: add `INTERRUPTED_NO_NOTE` and `RESOLVED_NO_CONCLUSION` lints
  - `packages/core/src/cli/scan.ts`, run-edit CLI subcommands: accept new value; refuse archive-on-RUNNING; emit warning when target is archived
- **Code (experiment-status + archive side)**:
  - `packages/core/src/types.ts`: new `ExperimentStatus` union + helpers; `ExperimentFrontMatter` gains `status` and `archived`
  - `packages/core/src/readme/parse.ts` / `serialize.ts` (experiment-doc paths): read/write new fields with documented defaults at parse time
  - new CLI module for `memon experiment status set` (analogous to `memon run status set`)
- **Code (archive)**:
  - `packages/core/src/discovery/archive.ts` and `discovery/discover.ts`: stop reading the sidecar as the source of truth; read `frontMatter.archived` instead. Keep a one-shot fallback that reads the sidecar **only** when the version stamp is < 4 (covers the in-flight migration moment).
  - `packages/core/src/discovery/scan.ts`: emit `archived` from frontmatter.
- **Code (FS migration)**:
  - `packages/core/src/version.ts`: `FS_CONVENTION_VERSION = 4`
  - `packages/core/src/fs-version/...`: runtime recognises v4 and dispatches to the v3→v4 transform
  - `packages/core/migrations/v3-to-v4.md`: new migration guide per `fs-migration-guide-authoring/spec.md`
  - new transform module: walks experiment docs (status + archived OPEN-fill) AND run dirs (sidecar→frontmatter)
- **Code (web)**:
  - `apps/web/components/status-pill.tsx` (and sibling color tables): six-value run color + three-value exp color + lucide icon mapping; `archived` desaturation overlay
  - `apps/web/components/experiment-card-grid.tsx`: card pill driven by `exp.frontMatter.status`; member-run runtime counts move to a secondary line under the title; archived treatment + filter toggle
  - `apps/web/components/edit-markdown-button.tsx` / status pickers: `<Select>` for `INTERRUPTED` (run picker), three-value picker (exp picker), archive toggle (both)
  - `apps/web/app/api/runs/[id]/readme/route.ts`, `apps/web/app/api/experiments/[id]/readme/route.ts`: persist new fields; return the soft warning when target is archived
- **APIs**: no shape changes to existing endpoints; the `RunFrontMatter` and `ExperimentFrontMatter` payloads gain `archived` (and `status` for exp). Successful writes to archived targets return a 200 with `{ ok: true, warning: 'archived', ... }` so the client can surface the toast. Journal-line parse output gains a new valid run-status value and a new `[EXP_STATUS]` event.
- **On-disk schema**:
  - Run README: gains `archived: bool` (required after v4). The status enum widens.
  - Experiment doc: gains `status: ExperimentStatus` and `archived: bool` (both required after v4).
  - `<runDir>/.archived` sidecar: removed by the v3→v4 migration; v4 readers SHALL NOT consult it.
- **Forward-compat for old readers**: a v3 reader pointed at a v4 project sees `status: INTERRUPTED` as `UNKNOWN` (parse warning), and silently drops the unknown `archived` and `status` (exp-side) keys (current parser tolerates extras). It will no longer find a `.archived` sidecar for archived runs and will list them as "not archived" — degraded but non-fatal. The migration guide flags this in the "Edge Cases" section.
- **Tests**: status-related unit tests in `packages/core/src/{status,readme,journal,discovery,fs-version}/*.test.ts`; archive-frontmatter migration test; web component tests for `StatusPill`, `ExperimentCard`, exp-status picker, archive toggle; doctor test for new lint codes; runtime test for the v3→v4 transform incl. sidecar deletion.
- **Skills**: orchestrator skills (e.g. `memon-drive`, `run-experiment`) that mention status / archive should be updated separately in a follow-up skills-only change per the established split-runtime-then-skills convention. This change targets runtime + UI only.
