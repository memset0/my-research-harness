## ADDED Requirements

### Requirement: Experiment doc write with optimistic mtime + content hash

The system SHALL accept experiment doc writes via
`PUT /api/experiments/:id/readme` carrying `expectedMtime` (and optional
`expectedHash`). The backend SHALL compare both against on-disk state
before writing.

The endpoint SHALL pass the `id` parameter through
`assertWithinProjectRoots()` before any filesystem access.

#### Scenario: Successful write
- **WHEN** `expectedMtime` and `expectedHash` match the on-disk values
- **THEN** the backend writes the new content, returns 200 with the new
  `mtime` + `hash`, and appends a `[EXPERIMENT]` event with `op=edit` to
  JOURNAL.md

#### Scenario: Conflict on mtime
- **WHEN** the on-disk mtime differs from `expectedMtime`
- **THEN** the backend returns 409 with the current on-disk content,
  `mtime`, and `hash`

### Requirement: Frontend save handshake bumps `updated_at` for exp docs

When the web markdown editor saves an experiment doc, the frontend SHALL
follow the same handshake described for runs (`run-edit`):
1. Capture `now()` ISO8601 with the user's local offset.
2. Rewrite the YAML frontmatter `updated_at` field in the editor buffer
   to that timestamp.
3. POST `{ content, expectedMtime, expectedHash }`.
4. On 200, replace the editor buffer with `finalContent` and store the
   new `mtime`/`hash`.
5. On 409, restore the editor's prior `updated_at` value visually before
   showing the conflict-resolution UI.

#### Scenario: Save bumps updated_at and persists
- **GIVEN** an exp doc with `updated_at: 2026-05-04T10:00:00+08:00`
  open in the editor at `expectedMtime: M0`
- **WHEN** the user clicks Save at `2026-05-04T11:30:00+08:00`
- **THEN** the POST body's frontmatter has `updated_at:
  2026-05-04T11:30:00+08:00`; the response is 200 and the editor stores
  the returned new mtime

### Requirement: `memon experiment create` allocates next E ID

The CLI SHALL expose `memon experiment create <slug> [--title <text>]
[--hypotheses H0001,H0003] [--from-run <run-dir>] [--project-root <p>]`.

The command SHALL:
1. Validate `<slug>` matches `^[a-z0-9][a-z0-9-]*[a-z0-9]$`.
2. Scan `docs/experiments/E*.md` to find the highest existing `NNNN`;
   compute the next id as `padId('E', max+1)`.
3. Refuse if any existing exp doc's slug equals the new slug or is a
   prefix of (or has as prefix) the new slug.
4. Write `docs/experiments/E<NNNN>-<slug>.md` with frontmatter populated
   (`id`, `slug`, `title`, `hypotheses`, `tags=[]`, `runs` initially `[]`
   or seeded from `--from-run`, `created_at=now`, `updated_at=now`) and
   empty body sections (`Motivation`, `Method`, `Conclusion`, `Caveats`,
   `Warnings` with the v3 header row).
5. If `--from-run <run-dir>` is given, validate the run exists, write
   `experiment: <new-id>` into the run's frontmatter, and add the run dir
   name to the new exp's `runs[]`. The run SHALL NOT already have a
   different `experiment:` value (would surface a `BAD_STATE` error).
6. Append a `[EXPERIMENT]` event with `op=create` to JOURNAL.

The command SHALL be retried up to 5 times if step 4's file creation
hits `EEXIST` (race against concurrent allocations); after 5 failures,
exit with `BAD_STATE`.

#### Scenario: Successful create
- **WHEN** the user runs `memon experiment create zero-snr-fix --title
  "Zero-SNR brightness study"`
- **THEN** `docs/experiments/E0001-zero-snr-fix.md` exists with valid
  frontmatter, body sections present, and JOURNAL has an `op=create`
  event

#### Scenario: --from-run binds existing run
- **WHEN** the user runs `memon experiment create foo --from-run
  bar-260501-100000`
- **THEN** the new exp's `runs[]` contains `bar-260501-100000`, and the
  run's `experiment:` field equals the new exp's id

#### Scenario: Slug prefix collision rejected
- **GIVEN** `E0001-foo` already exists
- **WHEN** the user runs `memon experiment create foo-bar`
- **THEN** the command exits with `EXPERIMENT_SLUG_PREFIX_COLLISION` and
  no file is written

### Requirement: `memon experiment link` and `unlink`

`memon experiment link <id> <run-dir-or-id> [--project-root <p>]` SHALL:
1. Validate the experiment doc exists.
2. Validate the run exists.
3. Refuse if the run already has a different `experiment:` field
   (`BAD_STATE`); print the conflicting exp id.
4. Append the run dir name to the exp's `runs[]` (if not already
   present).
5. Set the run's `experiment:` field to the exp id.
6. Append a `[BIND]` event with `op=link` to JOURNAL.
7. Print a non-blocking warning (stderr) if the run slug does NOT have
   the experiment slug as a prefix.

`memon experiment unlink <id> <run-dir-or-id>` SHALL undo the binding:
remove the run dir name from `exp.runs[]`, clear the run's
`experiment:` field, append a `[BIND]` event with `op=unlink`.

#### Scenario: Link respects soft prefix rule
- **GIVEN** `E0001-zero-snr-fix` and an unbound run `cfg-rescale-260502-...`
- **WHEN** the user runs `memon experiment link E0001-zero-snr-fix
  cfg-rescale-260502-...`
- **THEN** the link succeeds (exit 0); stderr contains a
  `RUN_SLUG_PREFIX_VIOLATION` warning

#### Scenario: Link rejected when run already bound elsewhere
- **GIVEN** a run with `experiment: E0002-bar`
- **WHEN** the user runs `memon experiment link E0001-foo <that-run>`
- **THEN** the command exits with `BAD_STATE` and stderr names the
  conflicting exp id `E0002-bar`; the user must `unlink` first

### Requirement: `memon experiment delete` cascades unlinks

`memon experiment delete <id> [--force] [--project-root <p>]` SHALL:
1. Read the exp doc.
2. For each run in `exp.runs[]`, clear the run's `experiment:` field.
3. Delete the exp doc file.
4. Append a `[EXPERIMENT]` event with `op=delete` and the deleted
   `runs[]` payload to JOURNAL.

Without `--force`, the command SHALL prompt for confirmation listing
the cascade impact (the runs that will be unbound). With `--force`, no
prompt is shown.

#### Scenario: Delete cascades and prompts
- **GIVEN** an exp `E0001-foo` with three confirmed runs
- **WHEN** the user runs `memon experiment delete E0001-foo` (no
  --force)
- **THEN** the CLI prompts "This will unbind 3 runs. Continue? [y/N]";
  on `y` the file is deleted, the three runs have their `experiment:`
  cleared, and JOURNAL has a `[EXPERIMENT] op=delete` event

#### Scenario: --force skips prompt
- **WHEN** the same command runs with `--force`
- **THEN** no prompt appears and the cascade applies immediately

### Requirement: Section-bound writes for the experiment Warnings section in the web UI

The web UI SHALL provide warning add/resolve/reopen/delete via REST
endpoints:
- `GET /api/experiments/:id/warnings`
- `POST /api/experiments/:id/warnings` body `{run, category, message,
  expectedMtime, expectedHash}` (the `run` field is optional; absent
  means the warning is exp-scoped)
- `PATCH /api/experiments/:id/warnings/:rowId` body `{op:
  "resolve"|"reopen", note?, expectedMtime, expectedHash}`
- `DELETE /api/experiments/:id/warnings/:rowId`

All endpoints SHALL pass `id` through `assertWithinProjectRoots()` and
invoke the section-bound writer defined in `experiment-readme`.

#### Scenario: POST attaches run attribution
- **WHEN** a client POSTs `{run: "bar-260501-100000", category:
  "result", message: "loss spike", expectedMtime, expectedHash}`
- **THEN** the new row's Run cell is `bar-260501-100000`, and the
  `[WARNING] op=add` JOURNAL event has `run: "bar-260501-100000"`

#### Scenario: POST without run attribution
- **WHEN** a client POSTs the same body without `run`
- **THEN** the new row's Run cell is `—`, and the JOURNAL event has
  `run: null`

### Requirement: Web editor side-panel layout and lazy-loaded Monaco

The exp detail page's `Edit markdown` action SHALL open a markdown editor
following the same responsive container rules as the v2 README editor:
- `<1024px`: full-screen `<Dialog>`
- `≥1024px`: right-side resizable panel beside the page body, NOT a
  Dialog

The editor module (Monaco core + worker + `@monaco-editor/react`) SHALL
NOT be in the initial JS bundle; it SHALL be dynamically imported on
first activation. On import failure, fall back to `<textarea>` with a
"Editor failed to load" toast.

The same toolbar layout from v2 applies: a controls row (title +
Plain/Monaco toggle + Copy markdown + Cancel/Save) above a path row
(rendered with smaller monospace font, truncate-on-overflow). The
white-canvas + line-numbers requirements continue to apply.

#### Scenario: Open editor on desktop
- **WHEN** the user is on `/p/<project>/e/<E-id>` at viewport ≥1024px and
  clicks `Edit markdown`
- **THEN** a right-side panel slides in (no Dialog), the page body stays
  in the left column, and the panel is resizable from its left edge

#### Scenario: Lazy-loaded Monaco
- **WHEN** the user is on the exp detail page but has not opened the
  editor yet
- **THEN** Monaco core, language workers, and `@monaco-editor/react` are
  not in the initial JS bundle

### Requirement: Run-panel actions inside the exp detail page

Each expanded run panel inside the exp detail page SHALL provide three
actions:
- `Edit markdown (run)` — opens the markdown editor on the run's README
  (uses `run-edit`'s save handshake)
- `Open Claude Code (run)` — opens at the project root with a hardcoded
  preset prompt naming the run dir and parent exp doc paths
- `Archive` — writes `<run-dir>/.archived` and removes the run from the
  expanded panel set

The exp-level action bar at the top of the page SHALL provide:
- `Edit markdown` — opens the editor on the exp doc
- `Open Claude Code` — opens at the project root with a preset prompt
  naming the exp doc path and the list of member run dirs

#### Scenario: Run-panel Edit operates on run README
- **WHEN** the user clicks `Edit markdown (run)` inside the panel for
  `bar-260501-100000`
- **THEN** the editor opens with the content of
  `<projectRoot>/<...>/bar-260501-100000/README.md`, and Save POSTs to
  `/api/runs/bar-260501-100000/readme`

#### Scenario: Open Claude Code preset prompts differ
- **WHEN** the user clicks the run-panel `Open Claude Code` button
- **THEN** the preset prompt names the run dir path and the exp doc
  path, distinct from the exp-level button's prompt which names the exp
  doc path and the run list

## REMOVED Requirements

### Requirement: Status edit control on the detail page

**Reason**: The exp doc does not have a status field of its own — the
exp's status pill in the UI is computed from the aggregate of member
runs' statuses. Run status is edited via run-side editing (or by the
process owning the run); the exp page does not expose a per-exp status
control.

**Migration**: Users who relied on hand-editing exp status should now
edit the relevant run's `status` field. The aggregate exp status
recomputes automatically.

### Requirement: README inline editor

**Reason**: V2's editor was the canonical README editor for the
single-file experiment model. In v3 there are two surfaces — the exp
doc and the run README — each with its own `Edit markdown` action; the
underlying editor component is shared but the API contract is split.
The above `### Requirement: Web editor side-panel layout and lazy-loaded
Monaco` is the v3 contract for the exp surface; the run surface mirrors
the same rules per `run-edit`.

**Migration**: Users see two `Edit markdown` buttons (exp + run) instead
of one.

### Requirement: Desktop side-panel layout for the README editor

**Reason**: Replaced by the new `### Requirement: Web editor side-panel
layout and lazy-loaded Monaco` above, which applies to both surfaces.

**Migration**: No user action.

### Requirement: Desktop side panel collapse, expand, and resize

**Reason**: The collapse/expand/resize behavior is preserved verbatim in
the v3 editor; we omit re-stating those scenarios here. The implementer
SHOULD continue to honor the v2 specifications for keyboard, drag
handle, persistence keys, and clamp boundaries.

**Migration**: No user action; behavior unchanged.

### Requirement: Conflict resolution dialog

**Reason**: The conflict-resolution dialog continues unchanged; it is
re-used from the v2 implementation for both exp and run editors.

**Migration**: No user action.

### Requirement: localStorage draft autosave

**Reason**: localStorage draft autosave continues unchanged with key
patterns extended to cover both surfaces (`memon:draft:<exp-doc-path>:
<mtime>` and `memon:draft:<run-readme-path>:<mtime>`).

**Migration**: Existing drafts under v2 keys for run READMEs continue to
work (the path is unchanged); drafts under v2 keys for what is now an
exp doc would not match the new file path and would be silently
discarded by the existing 7-day cleanup.

### Requirement: Draft recovery prompt on editor open

**Reason**: Continues unchanged for both surfaces.

**Migration**: No user action.

### Requirement: 7-day stale draft cleanup

**Reason**: Continues unchanged.

**Migration**: No user action.

### Requirement: Warnings card draft autosave parity

**Reason**: Continues unchanged; the path in the localStorage key is
the exp doc path under v3 (was the run README path under v2 because
warnings lived on runs).

**Migration**: Pre-existing v2 warning-edit drafts keyed under run paths
expire via the existing 7-day cleanup.

### Requirement: Warnings card uses the conflict-resolution dialog

**Reason**: Continues unchanged in v3 (now operates on exp doc instead
of run README).

**Migration**: No user action.

### Requirement: Add NOTE event from detail page

**Reason**: The exp detail page provides the same `+ Note` action; the
target id sent to `/api/journal/append` is now the experiment id
(`E<NNNN>-<slug>`) instead of a run dir name.

**Migration**: Skill code paths that POST notes against an experiment
should send the new exp id format. Run-attributed notes are still
supported via the run-panel actions (the notes UI on the run panel POSTs
the run dir name).

### Requirement: Add NOTE / REQUEST from journal page

**Reason**: Unchanged; tag set still includes `NOTE` / `REQUEST`.

**Migration**: No user action.

### Requirement: Create experiment from web UI

**Reason**: V2's "create experiment" created what we now call a run.
That action is reframed in v3: the web UI's `+ New experiment` button
creates a new exp doc (`memon experiment create` semantics). Creating
new runs is intentionally agent-driven in v3 (per the user's design
choice that the run-creation flow lives in the write-script skill).

**Migration**: To start a new run, the user opens Claude Code from
either the exp page or the project root; the agent walks the user
through scaffolding the run dir.

### Requirement: POST /api/experiments backend route

**Reason**: The route's semantics flip in v3 to operate on the exp doc
layer (was: run scaffolding). The new contract is on the implementation
side; the backend route accepts `{slug, title, hypotheses?, tags?,
fromRun?}` and runs the same logic as `memon experiment create`. We
treat this as an implementation detail; the spec-level contract is the
CLI command above.

**Migration**: External clients of `POST /api/experiments` would need to
update their request shape. There are none.
