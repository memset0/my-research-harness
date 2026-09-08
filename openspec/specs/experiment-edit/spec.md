# experiment-edit Specification

## Purpose
TBD - created by archiving change add-write-flow. Update Purpose after archive.
## Requirements
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
2. Scan `docs/experiments/` to find the highest existing `NNNN`. The
   scan SHALL accept each entry that matches *either* the post-v5
   folder shape `E<NNNN>-<slug>` (`EXPERIMENT_DIR_REGEX`) *or* the
   legacy v4 file shape `E<NNNN>-<slug>.md` (`EXPERIMENT_FILENAME_REGEX`,
   retained for the v4→v5 migration window where both forms may
   coexist briefly). The next id SHALL be computed as `padId('E', max+1)`
   across the union of both forms. When the directory does not exist
   the next id SHALL be `'E0001'`.
3. Refuse if any existing exp doc's slug equals the new slug or is a
   prefix of (or has as prefix) the new slug.
4. Write `docs/experiments/E<NNNN>-<slug>/README.md` (post-v5: an
   `E<NNNN>-<slug>/` folder containing a `README.md`) with frontmatter
   populated (`id`, `slug`, `title`, `hypotheses`, `tags=[]`, `runs`
   initially `[]` or seeded from `--from-run`, `created_at=now`,
   `updated_at=now`, plus `status: OPEN` and `archived: false` per
   `lifecycle-frontmatter-v4`) and empty body sections (`Motivation`,
   `Method`, `Conclusion`, `Caveats`, `Warnings` with the v3 header
   row). The folder is also the experiment's sanctioned local scratch
   space; the create step creates only the folder + README, and
   nothing else inside.
5. If `--from-run <run-dir>` is given, validate the run exists, write
   `experiment: <new-id>` into the run's frontmatter, and add the run dir
   name to the new exp's `runs[]`. The run SHALL NOT already have a
   different `experiment:` value (would surface a `BAD_STATE` error).
6. Append a `[EXPERIMENT]` event with `op=create` to JOURNAL.

The command SHALL be retried up to 5 times if step 4's directory or
file creation hits `EEXIST` (race against concurrent allocations);
after 5 failures, exit with `BAD_STATE`.

#### Scenario: Successful create on a v5 project root
- **WHEN** the user runs `memon experiment create zero-snr-fix --title
  "Zero-SNR brightness study"` on a project root where no experiments
  exist
- **THEN** `docs/experiments/E0001-zero-snr-fix/README.md` exists with
  valid frontmatter, body sections present, and JOURNAL has an
  `op=create` event

#### Scenario: Allocation respects existing v5 folders
- **GIVEN** a project root containing the v5 folders
  `docs/experiments/E0001-foo/README.md`,
  `docs/experiments/E0003-baz/README.md`,
  `docs/experiments/E0007-bar/README.md`
- **WHEN** the user runs `memon experiment create new-thing`
- **THEN** the new experiment is written to
  `docs/experiments/E0008-new-thing/README.md` (NOT `E0001-`,
  `E0002-`, `E0004-`, or `E0008-` if a `.md` legacy file at any of
  those numbers were also present; see next scenario)

#### Scenario: Allocation counts legacy v4 entries during migration
- **GIVEN** a project root mid-migration with both
  `docs/experiments/E0001-foo/README.md` (v5 folder) and
  `docs/experiments/E0002-legacy.md` (v4 file not yet moved)
- **WHEN** the user runs `memon experiment create third`
- **THEN** the new experiment is allocated as `E0003-third` (max+1 over
  the union of both forms), written to
  `docs/experiments/E0003-third/README.md`

#### Scenario: --from-run binds existing run
- **WHEN** the user runs `memon experiment create foo --from-run
  bar-260501-100000`
- **THEN** the new exp's `runs[]` contains `bar-260501-100000`, and the
  run's `experiment:` field equals the new exp's id

#### Scenario: Slug prefix collision rejected
- **GIVEN** `E0001-foo` already exists (as a v5 folder)
- **WHEN** the user runs `memon experiment create foo-bar`
- **THEN** the command exits with `EXPERIMENT_SLUG_PREFIX_COLLISION` and
  no folder or file is written

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

Each expanded run panel inside the exp detail page SHALL provide two actions:
- `Edit markdown (run)` — opens the markdown editor on the run's README
  using `run-edit`'s save handshake.
- `Archive` — writes `<run-dir>/.archived` and removes the run from the
  expanded panel set.

The exp-level action bar at the top of the page SHALL provide `Edit markdown`
to open the editor on the Experiment document.

The web load path for the run README inside `Edit markdown (run)`
SHALL go through an id-addressed helper that derives the absolute
`README.md` file path from the run dir before reading it. The helper
SHALL NOT pass the run directory itself to the legacy
`/api/readme?path=…` endpoint — that endpoint expects a file path
and returns `EISDIR` when handed a directory.

#### Scenario: Run-panel Edit operates on run README
- **WHEN** the user clicks `Edit markdown (run)` inside the panel for
  `bar-260501-100000`
- **THEN** the editor opens with the content of
  `<projectRoot>/<...>/bar-260501-100000/README.md`, and Save POSTs to
  `/api/runs/bar-260501-100000/readme`

#### Scenario: Run README load uses id-addressed helper, not raw run path
- **GIVEN** a run dir whose `Run.path` is the directory itself (the v3
  shape)
- **WHEN** the user clicks `Edit markdown (run)`
- **THEN** the editor's load helper resolves the run dir via
  `GET /api/runs/:id`, joins `/README.md`, and reads the resulting
  file path — and the resulting `Could not load README` error path
  is NOT triggered (the legacy `EISDIR` regression must not return)


### Requirement: Files-in-run-dir tree display

The exp detail page's expanded run panel SHALL render a tree view of
the run dir contents (sourced from `/api/runs/:id/files?depth=…`)
with the following display rules:

- Each node SHALL render only the **last path segment** of its
  `path` (the basename), NOT the full relative path returned by the
  API. The root node (`path: '.'`) SHALL render as `(run dir)`.
- Icons SHALL use the lucide icon set (matching the rest of the
  dashboard), NOT Unicode emoji. Specifically:
  - File rows: `<File>` icon.
  - Directory rows: `<Folder>` (collapsed) or `<FolderOpen>`
    (expanded).
  - Directory rows SHALL NOT render a leading
    `<ChevronRight>` / `<ChevronDown>`. The Folder ↔ FolderOpen
    morph alone conveys the open/closed state, and dropping the
    chevron means folder rows align horizontally with file rows
    (single icon column at every depth).
- Per-depth indent SHALL be at least `16px` per level so hierarchy is
  scannable.
- Each directory row (excluding the root) SHALL display a recursive
  descendant count next to the basename, formatted as a small muted
  number (e.g. `(12)` or with a tabular-nums classed span). The
  count SHALL be the total of files and subdirectories at all
  depths beneath this node.
- Directory rows SHALL be clickable to toggle expand/collapse.
  Clicking anywhere on the directory row toggles its state. The
  initial state for a non-root directory SHALL be:
  - **Collapsed** if its recursive descendant count is **> 10**.
  - **Expanded** otherwise.
- The root row is always expanded; clicking it is a no-op.
- The pre-existing `(truncated)` indicator next to the section
  heading (when the API reports `truncated: true`) SHALL be
  preserved.

#### Scenario: Basename rendering, no path duplication
- **GIVEN** an API response where a directory has
  `path: "logs"` and a file inside it has `path: "logs/stdout.log"`
- **WHEN** the tree renders
- **THEN** the directory row's text is `logs` (NOT `logs/`-or-
  longer)
- **AND** the file row's text is `stdout.log` (NOT
  `logs/stdout.log`)

#### Scenario: Folder shows recursive descendant count
- **GIVEN** a directory whose subtree contains 4 files and 2
  sub-directories (the sub-directories together contain 5 more
  files), so 4 + 2 + 5 = 11 descendants
- **WHEN** the tree renders this directory row
- **THEN** the row displays a small muted `11` next to the basename

#### Scenario: Folder collapsed by default when recursive count > 10
- **GIVEN** a directory whose recursive descendant count is 11
- **WHEN** the tree first renders
- **THEN** the directory row is collapsed (its children are NOT in
  the DOM); the folder icon is `<Folder>` (no chevron)

#### Scenario: Folder expanded by default when recursive count ≤ 10
- **GIVEN** a directory whose recursive descendant count is 7
- **WHEN** the tree first renders
- **THEN** the directory row is expanded (its children ARE in the
  DOM); the folder icon is `<FolderOpen>` (no chevron)

#### Scenario: Click toggles a folder's expand state
- **GIVEN** a folder collapsed by default (count 11)
- **WHEN** the user clicks anywhere on its row
- **THEN** the folder expands (icon morphs Folder → FolderOpen,
  children render)
- **AND** clicking again collapses it back

#### Scenario: Folder and file rows align horizontally
- **GIVEN** a directory containing both a sub-directory and a file
  at the same depth
- **WHEN** the tree renders both rows
- **THEN** the leading icon (`<Folder>` for the dir, `<File>` for
  the file) starts at the same horizontal x-position — there is
  no chevron-width offset on the folder row

### Requirement: Expanded run panel surfaces full run information

The expanded run panel inside the v3 exp detail page SHALL render every piece of information from the legacy run-as-experiment page (`/p/<project>/experiments/<id>`) that's still relevant under the v3 model — so users don't need to follow a "(legacy)" link to see standard run metadata, edit run status, or browse logs. The panel content sits below the trigger row inside the `<CollapsibleContent>` and is laid out as **three flat divider-separated stripes** in this top-to-bottom order:

1. **Action stripe** (`border-t p-3`) — primary actions for `Edit markdown`
   and `+ Note`; followed by `<StatusEdit>` and the parse-errors
   `<Badge variant="destructive">` when `run.parseErrors.length > 0`.
2. **Frontmatter stripe** (`border-t p-3`) — a 2-column-on-mobile
   / 4-column-on-desktop dl grid of frontmatter fields:
   name, project (only when it differs from the URL's project),
   created, finished, host, pid, gpus, entry, command (full-width),
   wandb (full-width link), tags (full-width Badges), hypotheses
   (full-width linked Badges). Field labels use
   `text-[10px] uppercase tracking-wide text-muted-foreground`.
   The stripe SHALL NOT render an extra `<run.id>` + status row at
   its top — the trigger row above already shows id + status, and
   StatusEdit is now in the action stripe.
3. **Body stripe** (`border-t p-3`) — Setup, Result, per-run
   Artifacts, LogViewer (`<LogViewer expPath={run.path} />` — the
   same component the legacy page uses), and the Files-in-run-dir
   tree (with the reworked basename + count + collapse behavior).

The stripe `<div>`s SHALL be direct children of
`<CollapsibleContent>` so each stripe's `border-t` spans the full
width of the run panel — the divider's left and right ends connect
to the panel's outer border rather than sitting inside an outer
`p-3` wrapper.

The `<WarningsCard>` SHALL NOT appear inside the run panel.
Warnings management for an experiment lives on the exp doc's
`## Warnings` section only — the per-run warnings table was a v2
artifact and duplicating it inside each run panel was noise.

The previously-existing "Open run page (legacy)" `<Link>` SHALL NOT
appear in the panel.

#### Scenario: Three stripes with edge-to-edge dividers
- **GIVEN** a user has expanded a run panel
- **WHEN** the panel renders
- **THEN** the `<CollapsibleContent>` contains three direct child
  `<div>` blocks, each with `border-t p-3`, in this order: action
  stripe → frontmatter stripe → body stripe
- **AND** none of those blocks is wrapped inside an additional
  outer `p-3` div (so the `border-t` lines on the stripes span the
  full content-box width and visually connect to the run panel's
  outer border)

#### Scenario: Action stripe order
- **WHEN** the action stripe renders
- **THEN** its primary actions appear in this order: `Edit markdown`, `+ Note`
- **AND** `StatusEdit` and any parse-errors Badge follow those actions


#### Scenario: Action bar is above the frontmatter
- **WHEN** the panel renders
- **THEN** the order of children inside `<CollapsibleContent>` is
  action stripe FIRST, then frontmatter stripe, then body stripe

#### Scenario: StatusEdit lives in the action stripe
- **GIVEN** a run with status `RUNNING`
- **WHEN** the panel renders
- **THEN** the editable `<StatusEdit>` control appears inside the
  action stripe, NOT inside the frontmatter stripe

#### Scenario: Frontmatter stripe omits redundant id row
- **WHEN** the panel renders
- **THEN** the frontmatter stripe does NOT render a `<run.id>` +
  status row at its top — its first child is the dl grid of
  frontmatter fields

#### Scenario: WarningsCard is absent from the run panel
- **GIVEN** a run whose README has a `## Warnings` table
- **WHEN** the panel is expanded
- **THEN** there is NO `<WarningsCard>` rendered inside the panel
  (the panel does not import or reference WarningsCard at all)

#### Scenario: Log viewer reuses the legacy component
- **GIVEN** a run whose dir contains log files (per
  `/api/log-files?expPath=…`)
- **WHEN** the panel is expanded
- **THEN** the same `<LogViewer>` component used by the legacy
  run page is rendered inside the body stripe — there is exactly
  one log-viewer component implementation in the web app, used by
  both routes

#### Scenario: No legacy escape hatch
- **GIVEN** the user has expanded the panel
- **WHEN** the panel renders
- **THEN** there is NO `<Link>` whose visible text is "Open run
  page (legacy)" inside the panel

### Requirement: Run panel expand/collapse is animated

The run panels on the v3 exp detail page SHALL animate their
height between collapsed and expanded states (instead of snapping
instantly). The animation SHALL be implemented via shadcn's
`<Collapsible>` (Radix-based) primitive paired with
`tw-animate-css`'s `animate-collapsible-down` and
`animate-collapsible-up` keyframes — keyed on the Radix-supplied
CSS variable `--radix-collapsible-content-height` so the
animation interpolates between `0` and the natural content height
(no fixed-height assumption).

The animating element SHALL carry `overflow-hidden` so the inner
content is clipped to the animating box during the height
transition (without it, the rich panel content — including the
LogViewer's sticky header and the file tree — visibly bleeds past
the panel during the transition).

The animation SHALL preserve all existing state plumbing:
- The controlled `open` state (`useState`).
- The localStorage persistence under
  `memon:exp-page:<expId>:<runId>:open` (writes on user click,
  reads on mount).
- The auto-expand behavior when the URL has
  `?run=<this-run-id>`.

The trigger element (the row containing the status pill, the
monospace run id, and the right-aligned timestamp / host) SHALL
keep its current visual layout and click-through behavior.

#### Scenario: Collapsed → expanded animates height
- **WHEN** the user clicks a collapsed run-panel trigger row
- **THEN** the panel's content area animates from height 0 to its
  natural height over the tw-animate-css `collapsible-down`
  keyframe duration (~200 ms by default)
- **AND** during the animation, content is clipped via
  `overflow-hidden` so it doesn't visually escape the panel box

#### Scenario: Expanded → collapsed animates height
- **WHEN** the user clicks an expanded run-panel trigger row
- **THEN** the panel's content area animates from its natural
  height back to 0 over the `collapsible-up` keyframe duration

#### Scenario: localStorage persistence is unchanged
- **GIVEN** a user previously expanded a panel for run
  `bar-260501-100000`
- **WHEN** the page reloads
- **THEN** the panel re-expands (animated) and the
  `memon:exp-page:<exp>:bar-260501-100000:open` localStorage entry
  is `1`

#### Scenario: ?run=<id> auto-expands the matching panel
- **GIVEN** the user navigates to
  `/p/<project>/e/<exp>?run=<some-run-id>`
- **WHEN** the page mounts
- **THEN** the panel for that run animates open (no longer starts
  open without animation)

### Requirement: `## Plan` section edits go through the existing markdown write path

Edits to an experiment doc's `## Plan` section SHALL be performed via
the existing `PUT /api/experiments/:id/readme` endpoint (the same path
used for editing any other experiment doc body section). No new API
endpoint is introduced for Plan in v1.

The frontend save handshake for Plan edits SHALL be identical to the
handshake already specified for experiment doc writes
(`expectedMtime` + `expectedHash`, `updated_at` rewritten in the
editor buffer to `now()`-with-offset, `finalContent` re-baselined on
200, conflict UI on 409).

The `PUT /api/experiments/:id/readme` endpoint SHALL preserve the
`## Plan` section body verbatim through the parse → mutate → serialize
cycle: a write that does not target Plan SHALL NOT alter Plan's body
(byte-for-byte, modulo trailing whitespace normalization the
serializer already performs on every section).

After a successful Plan edit, the backend SHALL fire the existing
`experiment-change` SSE topic (no new topic is introduced for Plan).
The TanStack query keys `['experiment', id]` and
`['experiments', project]` SHALL be invalidated by the existing
listener wiring.

#### Scenario: Plan edit via Edit markdown dialog persists
- **GIVEN** an experiment doc with `## Plan` body containing
  `- [ ] Try LR=3e-4` open in the Edit markdown dialog
- **WHEN** the user changes that line to `- [x] Try LR=3e-4` and
  clicks Save
- **THEN** the POST body's serialized markdown contains the updated
  `[x]` marker; the response is 200; the returned `finalContent`
  contains the new marker; the `experiment-change` SSE topic fires
  for that experiment

#### Scenario: Non-Plan edit preserves Plan body byte-exact
- **GIVEN** an experiment doc with a non-empty `## Plan` body
  containing nested checkboxes
- **WHEN** the user opens the Edit markdown dialog, modifies only the
  `## Method` body, and saves
- **THEN** the on-disk file's `## Plan` body after the write equals
  its body before the write (modulo trailing-whitespace normalization)

#### Scenario: Plan edit on a doc with no prior Plan section
- **GIVEN** a legacy experiment doc with no `## Plan` heading
- **WHEN** the user opens the Edit markdown dialog (which renders
  the empty-Plan placeholder), adds a `- [ ] First task` line under
  a freshly-typed `## Plan` heading, and saves
- **THEN** the response is 200; the on-disk file now contains a
  `## Plan` H2 in the canonical position (after Method, before
  Conclusion) with the new task line

#### Scenario: Concurrent Plan edit conflict surfaces 409
- **GIVEN** two browser tabs open the same experiment doc and both
  observe `expectedMtime: M0`
- **WHEN** tab A saves a Plan edit and the disk mtime advances to M1,
  then tab B saves its own Plan edit with `expectedMtime: M0`
- **THEN** tab B receives 409 with the current on-disk content,
  `mtime: M1`, and `hash`; tab B's editor buffer is restored and the
  conflict UI shows

### Requirement: `memon experiment status set` writes status + appends [EXP_STATUS] atomically

`memon experiment status set <id> --project-root <path> --to <STATUS> --expected-mtime <ms>` SHALL:
1. Read the exp doc at `docs/experiments/<id>.md`
2. Verify its mtime matches `--expected-mtime`; if not, exit 9 with `CONFLICT` and emit current content + mtime to stdout
3. Apply `<STATUS>` (a value from the `ExperimentStatus` enum: `OPEN` / `RESOLVED` / `ABANDONED`) to the frontmatter
4. Atomically write the new doc (temp file + rename), bumping `updated_at`
5. Append a `[EXP_STATUS] \`<id>\` <FROM> → <TO>` event to JOURNAL.md if status actually changed
6. If the on-disk doc has `archived: true`, emit the soft warning per `archive-frontmatter`

If the experiment doc is missing, the command SHALL exit 4 with `NOT_FOUND`. If `<STATUS>` is not in the `ExperimentStatus` enum, the command SHALL exit 2 with `BAD_REQUEST`.

#### Scenario: Successful status set
- **GIVEN** an exp doc `E0001-zero-snr-fix` with `status: OPEN`
- **WHEN** the user runs `memon experiment status set E0001-zero-snr-fix --project-root <p> --to RESOLVED --expected-mtime <current>`
- **THEN** the doc's frontmatter has `status: RESOLVED`
- **AND** JOURNAL has a new line `[EXP_STATUS] \`E0001-zero-snr-fix\` OPEN → RESOLVED`
- **AND** stdout `{"ok":true,"mtime":<n>,"prevStatus":"OPEN","nextStatus":"RESOLVED"}`

#### Scenario: Status unchanged → no JOURNAL event
- **WHEN** the requested status equals the current status
- **THEN** the doc is rewritten (new mtime returned) but no JOURNAL event is appended; stdout has `journalAppended: false`

#### Scenario: Out-of-enum value rejected
- **WHEN** the user runs `... --to CONCLUDED`
- **THEN** the command exits 2 with `{"error":{"code":"BAD_REQUEST","message":"unknown ExperimentStatus value 'CONCLUDED'; expected OPEN|RESOLVED|ABANDONED"}}`

#### Scenario: Status set on archived exp emits warning
- **GIVEN** an exp doc with `status: OPEN, archived: true`
- **WHEN** the user runs `memon experiment status set <id> --to ABANDONED --expected-mtime <current>`
- **THEN** stderr contains `warning: <id> is archived; modifying anyway`
- **AND** stdout JSON additionally contains `"warning":"archived"`
- **AND** the status transitions to ABANDONED

### Requirement: Web `PUT /api/experiments/:id/readme` accepts new fields

The endpoint SHALL accept exp doc content whose frontmatter includes the v4-canonical `status: <ExperimentStatus>` and `archived: <boolean>` fields. The endpoint SHALL apply the soft-warning path per `archive-frontmatter` when the on-disk doc has `archived: true`. The endpoint SHALL NOT apply any hard-rule constraint between exp status and exp archive (the cannot-archive-RUNNING rule is run-specific).

The response body for a successful status-changing write SHALL include `prevStatus` and `nextStatus` so the web client can correlate with the corresponding `[EXP_STATUS]` JOURNAL event for cache invalidation.

#### Scenario: Successful write with status change
- **GIVEN** an exp doc on disk with `status: OPEN, archived: false`, `mtime: M0`
- **WHEN** the client POSTs new content with `status: ABANDONED, archived: false`, `expectedMtime: M0, expectedHash: H0`
- **THEN** the response is 200 with `{ ok: true, mtime: <new>, hash: <new>, finalContent: '...', prevStatus: 'OPEN', nextStatus: 'ABANDONED' }`
- **AND** an `[EXP_STATUS] OPEN → ABANDONED` JOURNAL event is appended

#### Scenario: Soft warning when archived
- **GIVEN** an exp doc with `archived: true`
- **WHEN** the client POSTs a body change
- **THEN** the response includes `warning: 'archived'` in addition to the success fields
- **AND** the web client surfaces a sonner toast

### Requirement: Web status picker for experiment cards / detail pages

The web UI's exp-doc edit affordance (`EditMarkdownButton` / equivalent) SHALL include a `<Select>` with the three `ExperimentStatus` values (`OPEN` / `RESOLVED` / `ABANDONED`). Picking a value SHALL trigger the same `PUT /api/experiments/:id/readme` flow as a markdown edit, with the new value baked into the frontmatter. There SHALL NOT be an `UNKNOWN` option (the parser-only fallback is not user-selectable, and `ExperimentStatus` has no `UNKNOWN` value).

#### Scenario: Picker selection writes the new status
- **GIVEN** an exp detail page rendering `status: OPEN`
- **WHEN** the user selects `RESOLVED` from the status `<Select>`
- **THEN** the underlying `PUT /api/experiments/:id/readme` is invoked with the new frontmatter
- **AND** on 200, the page re-renders with `status: RESOLVED` and the corresponding pill

### Requirement: `resolveExperimentId` accepts slug or canonical id under v5

The core library SHALL expose `resolveExperimentId(projectRoot, needle):
Promise<string | null>` that maps a user-supplied `<id-or-slug>`
argument to a canonical `E<NNNN>-<slug>` id by scanning
`docs/experiments/`.

The scan SHALL accept each entry under `docs/experiments/` that matches
*either* `EXPERIMENT_DIR_REGEX` (the v5 folder shape) *or*
`EXPERIMENT_FILENAME_REGEX` (the legacy v4 file shape, retained for
the migration window). For every matching entry the canonical id is
`E<NNNN>-<slug>`, with any `.md` suffix on the legacy form stripped.

Resolution rules:

- When `needle` matches `^E\d{4}-` (i.e. carries a numeric prefix), the
  function SHALL return `needle` only when an entry with that exact
  canonical id exists; otherwise `null`.
- When `needle` is a bare slug (no `E\d{4}-` prefix), the function
  SHALL return the canonical id of the unique entry whose slug equals
  `needle`. Zero matches or multiple matches return `null`.
- When `<projectRoot>/docs/experiments/` does not exist, the function
  SHALL return `null`.

The function SHALL NOT depend on the presence of `README.md` inside
the folder — a folder that matches `EXPERIMENT_DIR_REGEX` is sufficient
to be considered an existing experiment for ID/slug resolution
purposes. (`discoverExperiments` separately surfaces a `MISSING_README`
parse error in that case.)

#### Scenario: Full canonical id resolves to itself when the v5 folder exists
- **GIVEN** `docs/experiments/E0001-fsdp-coll/README.md`
- **WHEN** `resolveExperimentId(root, 'E0001-fsdp-coll')` is called
- **THEN** it returns `'E0001-fsdp-coll'`

#### Scenario: Full canonical id returns null when no matching entry exists
- **GIVEN** `docs/experiments/` contains only `E0002-bar/`
- **WHEN** `resolveExperimentId(root, 'E0099-missing')` is called
- **THEN** it returns `null`

#### Scenario: Unique slug resolves to canonical id under v5
- **GIVEN** `docs/experiments/E0002-attention/README.md`
- **WHEN** `resolveExperimentId(root, 'attention')` is called
- **THEN** it returns `'E0002-attention'`

#### Scenario: Ambiguous slug returns null
- **GIVEN** `docs/experiments/E0001-fsdp-coll/` and
  `docs/experiments/E0003-fsdp-bug/` both exist; no slug exactly equals
  `'fsdp'`
- **WHEN** `resolveExperimentId(root, 'fsdp')` is called
- **THEN** it returns `null`

#### Scenario: Slug resolution works during the v4→v5 migration window
- **GIVEN** a mixed state: `docs/experiments/E0001-foo/README.md` (v5)
  alongside `docs/experiments/E0002-legacy.md` (legacy v4 file)
- **WHEN** `resolveExperimentId(root, 'legacy')` is called
- **THEN** it returns `'E0002-legacy'`

#### Scenario: Missing docs/experiments/ returns null
- **GIVEN** `docs/experiments/` does not exist on disk
- **WHEN** `resolveExperimentId(root, 'anything')` is called
- **THEN** it returns `null`

### Requirement: memon experiment rename cascades the new slug through exp, runs, and hypotheses

The CLI SHALL expose `memon experiment rename <id-or-slug> <new-slug> [--project-root <p>]`. The core library SHALL expose `renameExperiment(projectRoot, projectName, oldIdOrSlug, newSlug, options?): Promise<RenameExperimentResult>` as the underlying primitive. The command and the helper SHALL:

1. Validate `<new-slug>` against `^[a-z0-9][a-z0-9-]*[a-z0-9]?$` and reject `BAD_REQUEST` when it includes a trailing `-<YYMMDD>-<HHMMSS>` timestamp tail (the same SLUG_RE shape `memon run rename` uses).
2. Resolve `<id-or-slug>` to a canonical `E<NNNN>-<slug>` via `resolveExperimentId`. On no match, exit with `NOT_FOUND`.
3. Compute the new canonical id: `newId = E<oldNNNN>-<new-slug>` (the `NNNN` is preserved; only the slug part changes).
4. Treat `new-slug === old-slug` as a noop and return `{ ok: true, oldId, newId: oldId, noop: true }` without touching disk.
5. Refuse with `EXPERIMENT_SLUG_PREFIX_COLLISION` when another existing experiment has slug equal to `new-slug`, OR when `new-slug` is a prefix of another experiment's slug or vice versa (same uniqueness rule as `memon experiment create`).
6. On a v5 record, rename the experiment folder from `docs/experiments/<oldId>` to `docs/experiments/<newId>` via `fs.rename`. On the legacy v4 file form (`exp.path` ends in `<oldId>.md`), rename the single `.md` file to `<newId>.md`.
7. Open the post-rename README, set `frontMatter.id = newId`, `frontMatter.slug = new-slug`, `frontMatter.updated_at = nowIso()`, and atomic-write the re-serialized content.
8. For each id in the exp doc's `frontMatter.runs`, resolve the run via `scanProjectRoot`. When the run's `frontMatter.experiment` equals `oldId`, rewrite it to `newId` (bumping `updated_at`); leave unrelated mismatches alone.
9. Read `<projectRoot>/docs/hypotheses.md` and perform a token substitution of `oldId` → `newId` over the body. The substitution SHALL use word-boundary semantics (`\bE\d{4}-[a-z0-9-]+\b`) so that `oldId` cannot match a substring of an unrelated longer token. The atomic-write SHALL be skipped when the file content is unchanged.
10. Append one `[RENAME]` event to `docs/journal.md` with body `op=experiment-rename old=<oldId> new=<newId>`.

The command SHALL emit JSON on stdout: `{ ok: true, oldId, newId, noop?: true, warnings?: [...] }`. Soft warnings (e.g. a member run whose slug doesn't start with `new-slug`) SHALL appear both as one-line `{warning:{code,message}}` JSON events on stderr AND inside the stdout `warnings` array.

The command SHALL NOT roll back on partial failure. The validate-first posture catches every recoverable error before any disk mutation; if a later step fails (e.g. permission denied on a run README write), the user resolves manually via git and re-runs (the operation is idempotent on already-renamed input).

#### Scenario: Successful rename rewrites exp folder, bound runs, and hypotheses
- **GIVEN** a project root with:
  - Experiment folder `docs/experiments/E0001-foo/README.md` with `frontMatter.runs = ['foo-260501-100000', 'foo-260502-110000']`
  - Two bound runs `foo-260501-100000/README.md` and `foo-260502-110000/README.md`, each with `frontMatter.experiment = 'E0001-foo'`
  - A hypothesis in `docs/hypotheses.md` with `**Experiments**: E0001-foo` in its body
- **WHEN** the user runs `memon experiment rename E0001-foo zero-snr --project-root <root>`
- **THEN** stdout is `{"ok":true,"oldId":"E0001-foo","newId":"E0001-zero-snr"}`
- **AND** the folder `docs/experiments/E0001-zero-snr/` exists; `docs/experiments/E0001-foo/` does not
- **AND** the new folder's `README.md` frontmatter has `id: E0001-zero-snr`, `slug: zero-snr`, and `updated_at` bumped
- **AND** both bound runs' READMEs have `experiment: E0001-zero-snr` (updated atomically)
- **AND** `docs/hypotheses.md` contains `E0001-zero-snr` where `E0001-foo` previously appeared, with no other body changes
- **AND** `docs/journal.md` gains one new line: `- <ISO> [RENAME] op=experiment-rename old=E0001-foo new=E0001-zero-snr`

#### Scenario: Noop on same slug
- **GIVEN** experiment `E0001-foo` exists
- **WHEN** the user runs `memon experiment rename E0001-foo foo`
- **THEN** stdout is `{"ok":true,"oldId":"E0001-foo","newId":"E0001-foo","noop":true}`
- **AND** no disk write happens; mtimes unchanged; no JOURNAL event appended

#### Scenario: Slug uniqueness rejected
- **GIVEN** experiments `E0001-foo` and `E0002-bar` both exist
- **WHEN** the user runs `memon experiment rename E0001-foo bar`
- **THEN** the command exits with `EXPERIMENT_SLUG_PREFIX_COLLISION`
- **AND** stderr names the conflicting experiment `E0002-bar`
- **AND** no folder rename happens

#### Scenario: Slug prefix collision rejected
- **GIVEN** experiments `E0001-old` (slug `old`) and `E0002-foo` (slug `foo`) exist
- **WHEN** the user runs `memon experiment rename E0001-old foo-bar`
- **THEN** the command exits with `EXPERIMENT_SLUG_PREFIX_COLLISION`
  (because the existing slug `foo` is a prefix of the new slug `foo-bar` — same rule `memon experiment create` enforces)
- **AND** no disk mutation happens

#### Scenario: Slug prefix collision rejected the other direction
- **GIVEN** experiments `E0001-old` (slug `old`) and `E0002-foo-bar` (slug `foo-bar`) exist
- **WHEN** the user runs `memon experiment rename E0001-old foo`
- **THEN** the command exits with `EXPERIMENT_SLUG_PREFIX_COLLISION`
  (because the new slug `foo` is a prefix of the existing slug `foo-bar`)
- **AND** no disk mutation happens

#### Scenario: Invalid new slug shape rejected
- **WHEN** the user runs `memon experiment rename E0001-foo Foo`
  (uppercase) OR `memon experiment rename E0001-foo bar-260501-100000`
  (timestamp tail)
- **THEN** the command exits with `BAD_REQUEST`
- **AND** stderr names the SLUG_RE pattern

#### Scenario: Missing experiment id returns NOT_FOUND
- **WHEN** the user runs `memon experiment rename E0099-missing baz`
  on a project root that does not contain `E0099-missing`
- **THEN** the command exits with `NOT_FOUND`
- **AND** no disk mutation happens

#### Scenario: Member run slug-prefix violation surfaces a soft warning
- **GIVEN** experiment `E0001-foo` with member run `foo-260501-100000`
  (whose slug `foo` starts with the exp slug `foo`)
- **WHEN** the user runs `memon experiment rename E0001-foo bar`
  (so the new exp slug `bar` is no longer a prefix of the run slug `foo`)
- **THEN** the rename SHALL succeed (exit 0)
- **AND** stderr contains one line per offending member run with shape
  `{"warning":{"code":"RUN_SLUG_PREFIX_VIOLATION","message":"run slug \\"foo\\" does not start with experiment slug \\"bar\\""}}`
- **AND** stdout's `warnings` array contains an entry for each
  offending member run

#### Scenario: Idempotent re-run on already-renamed state
- **GIVEN** an exp at `docs/experiments/E0001-bar/` whose
  `frontMatter.id` is `E0001-bar`
- **WHEN** the user runs `memon experiment rename E0001-bar bar`
- **THEN** the command exits with `{"ok":true,"oldId":"E0001-bar","newId":"E0001-bar","noop":true}`
- **AND** no mtimes change

#### Scenario: Hypotheses substitution skipped when file does not mention the id
- **GIVEN** experiment `E0001-foo` exists and `docs/hypotheses.md`
  contains no `E0001-foo` token
- **WHEN** the user runs `memon experiment rename E0001-foo zero`
- **THEN** the rename succeeds
- **AND** `docs/hypotheses.md`'s mtime is unchanged (no write
  performed because content is unchanged)
