## Why

Today every "experiment" in memon is a single directory under `logs/`, and the
README inside it carries motivation, method, conclusion, warnings, and per-run
data all mixed together. In practice one research investigation usually
produces multiple runs (sweeps over hyperparameters, model variants, ablations,
re-runs after a fix). The current model forces a user to either (a) duplicate
the motivation/method/conclusion text across N run READMEs, or (b) pick one
"canonical" run and live with stale links. There is no first-class place for
the cross-run synthesis that *is* the actual research output.

This change introduces an **experiment** as a distinct, file-backed concept
that owns the "why / how / what we concluded across all runs", with **runs**
becoming pure execution records under the experiment.

## What Changes

- **BREAKING**: FS convention bumps **v2 → v3**. Existing projects MUST run
  `memon-migrate-fs` (agent-led) before memon will operate on them.
- **BREAKING**: Term "experiment" no longer refers to a `logs/<...>/` directory.
  Those are now called **runs**. The term "experiment" now means a logical
  grouping doc at `docs/experiments/E<NNNN>-<slug>.md`.
- New file layout:
  - `docs/experiments/E<NNNN>-<slug>.md` — experiment doc (motivation, method,
    conclusion, caveats, warnings); frontmatter lists member runs
  - `logs/<slug>-<YYMMDD>-<HHMMSS>/README.md` — run doc (setup, result,
    artifacts); frontmatter points to parent experiment
- New ID prefix `E` (joining `H`/`D`/`R`); 4-digit zero-padded; per-project
  monotonic.
- **BREAKING**: `project:` sub-project frontmatter field on runs is removed
  (parser stops reading it). Migration guide instructs the agent to delete it.
- **BREAKING**: `hypotheses:` array moves off run frontmatter (now exp-only).
- **BREAKING**: `tags:` array moves off run frontmatter (now exp-only).
- New run-side frontmatter field: `experiment: E<NNNN>-<slug>` (single value;
  one run belongs to at most one experiment).
- New run-side frontmatter field: `updated_at` (optional; defaults to
  `created_at`; `created_at` itself defaults to the parsed timestamp from the
  run dir name when absent).
- Section split: `Motivation`/`Method`/`Conclusion`/`Caveats`/`Warnings` move
  to the experiment doc; `Setup`/`Result`/`Artifacts` stay on the run.
  `## New Hypotheses` section is removed entirely (hypothesis discussion lives
  inline in `Motivation`/`Conclusion`).
- Warnings table gains a `Run` column so an experiment-level warning can name
  the run it originated from. Journal `[WARNING]` events gain a `run` field.
- New CLI commands: `memon experiment ls/create/show/link/unlink/delete`,
  `memon run rename`. The `experiment` CLI surface is the spelled-out word —
  no `exp` abbreviation anywhere.
- `memon run rename` only changes the slug part, never the timestamp;
  per-project slug uniqueness is enforced; back-reference in the parent
  experiment's `runs[]` is updated atomically.
- New web layout: list page becomes a grid of experiment cards (each card
  embeds a compact runs table + tags + effective times); the per-experiment
  detail page replaces the per-run detail page; runs render as collapsible
  panels inside the exp page.
- Editor save handshake updated: when the web UI saves an exp or run README,
  the frontend writes the current timestamp to the frontmatter `updated_at`
  field, refreshes the editor with the post-write content + new mtime, then
  POSTs with `expectedMtime` for the existing optimistic-lock contract.
- Bidirectional binding semantics: an experiment's effective member runs is
  the **intersection** of `experiment.runs[]` (frontmatter) and the runs
  whose `experiment:` field points back. Single-sided claims surface a
  structured anomaly (`ORPHAN_RUN`, `PHANTOM_RUN_REF`, or
  `MISMATCH_EXPERIMENT_REF`) and DO NOT count as membership.
- Web anomaly UI: a single yellow banner card pinned **above** the experiment
  grid lists every anomaly, scrollable, with a "copy all" button so the user
  can paste the report into an agent for resolution.
- "Open Claude Code" buttons exist at both the experiment card / page header
  level AND inside each expanded run panel; both open at the project root and
  inject a hardcoded preset prompt that names the experiment / run path.
- Soft naming convention: experiment name is a prefix of every member run's
  name. CLI `memon experiment link` and `memon doctor` surface a non-blocking
  warning when violated; `memon run rename` is the suggested fix.
- Hypothesis cross-references: `docs/hypotheses.md` per-H entries gain an
  optional `Runs:` field alongside `Experiments:`; the parser disambiguates by
  ID format (E\d{4}-... vs slug-YYMMDD-HHMMSS).
- Mock data under `mock/project-{a,b}/` is fully migrated to v3 (split into
  experiments + runs, sub-project label removed). Fictional groupings and
  cross-references are introduced as needed for a coherent demo dataset.
- **Out of scope (deferred to follow-up change)**: updating
  `memon install-skills` skill *content* templates to teach agents the new
  experiment-first workflow. The version marker still advances to v3 in this
  change; existing skills will guide the migration as-is.

## Capabilities

### New Capabilities

- `run-readme`: filesystem schema for `logs/<run-dir>/README.md` after the
  exp/run split — frontmatter required/optional fields, the
  `Setup`/`Result`/`Artifacts` body sections, the `experiment:` back-reference
  contract, and graceful-degradation behavior when fields are missing.
- `run-discovery`: discovery, indexing, polling, and archival semantics for
  run directories (the rules currently in `experiment-discovery` that govern
  run dirs, relocated and tightened around the new term).
- `run-edit`: write paths and optimistic-lock semantics for run READMEs,
  including the new `run rename` operation, the frontend `updated_at` save
  handshake, and the section-bound writer for the run-side `Warnings` slice
  (when warnings are run-scoped).
- `experiment-membership-anomalies`: the three anomaly classes (`ORPHAN_RUN`,
  `PHANTOM_RUN_REF`, `MISMATCH_EXPERIMENT_REF`), how the indexer detects them,
  what the API surfaces, and how the web UI presents the copy-paste banner.

### Modified Capabilities

- `experiment-readme`: completely rewritten — describes
  `docs/experiments/E<NNNN>-<slug>.md` with new frontmatter
  (`runs[]`, `hypotheses[]`, `tags[]`, `created_at`, `updated_at`, `title`)
  and new body sections (Motivation/Method/Conclusion/Caveats/Warnings with
  Run column).
- `experiment-discovery`: completely rewritten — discovery now scans
  `docs/experiments/*.md`, builds the index keyed by E ID, computes effective
  times by min/max'ing with member runs, and emits anomaly events when the
  indexer detects orphan/phantom/mismatch.
- `experiment-edit`: completely rewritten — covers the experiment-doc write
  path, the `experiment create/link/unlink/delete` CLI flows, the
  cascade-unlink behavior on delete (with confirmation), and the editor save
  handshake.
- `hypotheses`: per-H entry schema gains an optional `Runs:` field; the
  existing `Experiments:` field's intent shifts from "list of run dirs" to
  "list of E IDs" (mixed lists are tolerated by the parser via ID-format
  detection but a parse warning steers users to migrate).
- `fs-version-tracking`: `FS_CONVENTION_VERSION` constant advances to 3;
  scenarios that pin the value to 1 or 2 are updated to test the v3 path.
- `memon-cli`: adds `memon experiment ls/create/show/link/unlink/delete` and
  `memon run rename`; renames legacy `memon experiment ...` flows that
  operated on run dirs to `memon run ...` (e.g. the warnings sub-commands
  follow the run/exp split).
- `web-dashboard`: list page becomes an experiment-card grid; detail page
  becomes per-experiment with embedded run panels; the yellow anomaly banner
  is a top-of-list pinned card; old `/p/<project>/r/<run-dir>` URLs redirect
  to `/p/<project>/e/<E-id-slug>?run=<run-dir>` and auto-expand the matching
  run panel.
- `web-layout`: sidebar shows the per-project experiment count (not run
  count); the standalone "All Runs" entry is removed; deep-link rewrites for
  the legacy run URL surface in the layout's redirect table.
- `live-updates`: SSE / poll events extend to cover experiment-doc changes
  (new event topic `experiment` alongside `run`), and anomaly recomputation
  fires whenever either side of a binding changes.
- `journal`: new event tags `[EXPERIMENT]` (op=create/edit/delete),
  `[BIND]` (op=link/unlink), `[RENAME]` (op=run-rename); existing `[WARNING]`
  events gain a `run` field.

## Impact

- **Code packages**:
  - `packages/core`: `ids.ts` (add `E` prefix), `schemas.ts` (split run/exp
    types), `discovery/` (scan two layouts), `readme/` (split parsers and
    writers), `time.ts` (created_at-from-dirname helper), `migrations/v2-to-v3.md`
    (new agent-led guide), `version.ts` (bump constant).
  - `packages/cli`: new `experiment` and `run` subcommand trees; old
    `experiment` subcommands that operated on run dirs are renamed to `run`.
  - `apps/web`: new `/p/<project>/e/<id>` route, deletion of the old per-run
    detail page (replaced by query-param expansion on the exp page),
    `/api/experiments` route returns experiment docs (was: run list, now under
    `/api/runs`), new editor save handshake, anomaly banner component.
- **Mock data**: every README under `mock/project-*/logs/*` is rewritten;
  new `mock/project-*/docs/experiments/E*-*.md` files added; fictional
  cross-experiment groupings are introduced.
- **On-disk migration**: existing v2 projects need agent-led splitting; the
  guide at `packages/core/migrations/v2-to-v3.md` documents the step-by-step
  procedure consumed by the existing `fs-migration-runtime`.
- **API contract**: `/api/experiments` semantics flips (now returns exp docs);
  `/api/runs` is a new route returning the flat run list. Clients outside this
  repo would break — but there are none.
- **Out of scope**: Skill content updates (`memon install-skills` writes the
  same content as v2 during this change's window; an immediate follow-up
  change ships the v3 skill templates).
