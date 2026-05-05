## Why

The agent finds anomalies during a run (loss spike, config drift from the
paper, baseline mismatch, NaN, hardware blip) but today has no canonical
place to flag them for the human researcher. The journal is append-only
narrative, the README body sections are author-owned, and frontmatter is
schema-locked. So findings either get buried in `JOURNAL.md` events or
silently dropped, and the human never gets a "must look at this" surface
on the experiment record itself.

We need a structured, human-clearable Warnings surface on each run's
`README.md` so the agent can flag-but-not-decide, and the human can ack /
resolve / delete entries with a clear audit trail. Doctor sweeps should
also revisit older runs in light of new evidence and propose new warnings
(human approval gated).

## What Changes

- **Experiment README**: add an OPTIONAL `## Warnings` H2 section between
  `Caveats` and `Artifacts`. The section body is a single GFM table with
  columns: `Status`, `Created`, `Category`, `Message`, `Resolved`, `Note`.
  One warning per row. Status is `OPEN` or `RESOLVED`. Existing READMEs
  without this section remain valid (NOT a breaking change, no fs
  convention version bump).
- **Parser** (`@memon/core`): parse `## Warnings` table into
  `experiment.warnings: Warning[]` on each indexed entry; absence is
  `warnings: []` with no warning. Out-of-spec sections elsewhere in the
  README continue to be tolerated as today.
- **Section-bound writes**: README writes that target warnings SHALL only
  modify lines inside the `## Warnings` section. The CLI takes a
  line-range diff approach so concurrent edits to other sections don't
  conflict, while still requiring `expectedMtime` + `expectedHash` against
  the whole file.
- **CLI**: new `memon experiment warning` subcommands (`add`, `list`,
  `resolve`, `reopen`, `delete`) exposing strict-typed warning ops with
  mtime+hash optimistic locking. `memon doctor` learns a new
  `WARN_UNRESOLVED` informational code.
- **HTTP API**: new `/api/experiments/:id/warnings` endpoints (`GET`,
  `POST`, `PATCH /:rowId`, `DELETE /:rowId`). All go through
  `assertWithinProjectRoots()` and the section-bound write path.
- **Web dashboard**: render the Warnings table on the experiment detail
  page with inline interactive controls (toggle status, edit Note,
  delete row, append new row). Behind the same conflict-aware save flow
  as the README editor.
- **Skills**:
  - `memon-run-experiment` post-run review step: agent inspects
    `run.log` / wandb / loss curves and APPENDS `[OPEN]` warnings via
    `memon experiment warning add`. Cannot mark `[RESOLVED]`, cannot
    delete.
  - `memon-digest-journal` doctor sweep: per-experiment warning review
    over the (a) digest-window-touched + (b) any-still-open scope.
    Surfaces proposed new warnings to the user; only appends after user
    confirmation.
  - new `memon-append-warning` skill (model-invocable, low-stakes
    append) for ad-hoc "I noticed something on an older run" flows.
    Mirrors the risk tier of `memon-append-journal`.
- **Hard rule on AI authority**: agents MAY append `[OPEN]` warnings.
  Agents MUST NOT mark warnings `[RESOLVED]`, edit existing rows, or
  delete rows. State changes and deletion are human-only acts (CLI
  exposes them, but skills SHALL NOT call them).

## Capabilities

### New Capabilities

(none — this change extends existing capabilities only)

### Modified Capabilities

- `experiment-readme`: add Warnings section schema, table format, parser
  rules, and section-bound write semantics.
- `memon-cli`: add `memon experiment warning` subcommands and a
  `WARN_UNRESOLVED` doctor code.
- `memon-skills`: amend `memon-run-experiment` to add a post-run warning
  review step; amend `memon-digest-journal` doctor sweep to walk
  per-experiment warning review; add a new `memon-append-warning` skill
  to the bundled set; document the AI-authority hard rule (append-only,
  no resolve / no delete).
- `web-dashboard`: render and interactively edit the Warnings table on
  the experiment detail page, using the existing conflict-aware save
  flow.
- `experiment-edit`: warnings-aware editor surface (per-row controls,
  section-bound save, draft autosave parity).

## Impact

- **Code**: `packages/core` parser (Warnings section + table parsing,
  Warning type), `packages/cli` (new `experiment warning` subcommands,
  section-bound writer, new `WARN_UNRESOLVED` doctor code),
  `apps/web` (Warnings card UI, interactive editor wiring, new
  HTTP routes), `packages/skills` (run-experiment §7, digest-journal
  doctor sweep, new append-warning skill).
- **Specs synced on archive**: `experiment-readme`, `memon-cli`,
  `memon-skills`, `web-dashboard`, `experiment-edit`.
- **Compatibility**: backward-compatible. Old READMEs without
  `## Warnings` parse as `warnings: []` and behave exactly as today.
  No fs convention version bump.
- **Agent behaviour**: agents must learn the append-only rule; this is
  enforced by skill text + CLI authority split (skills SHALL NOT call
  resolve/delete).
- **Risks**: section-bound writes need careful testing so that an
  agent's `warning add` cannot truncate or rewrite other sections; the
  conflict path (concurrent edit to `## Method` while the agent is
  appending a warning) must surface a proper 409 rather than silently
  win.
