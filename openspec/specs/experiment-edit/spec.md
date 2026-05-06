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

#### Scenario: Open Claude Code preset prompts differ
- **WHEN** the user clicks the run-panel `Open Claude Code` button
- **THEN** the preset prompt names the run dir path and the exp doc
  path, distinct from the exp-level button's prompt which names the exp
  doc path and the run list

### Requirement: `POST /api/open-claude-code` resolves a target's working directory

The web layer SHALL expose `POST /api/open-claude-code` accepting a
JSON body `{ kind: 'exp' | 'run', id: string, projectName: string }`.
The endpoint resolves the working directory for a Claude Code launch
on the given target and returns a copy-paste command. It does NOT
spawn a process — `memon serve` is shared across users on a cluster,
so server-side spawn would launch in the wrong session.

The response shape SHALL be `{ command: string, cwd: string, hint:
string }`:
- `command` — a shell-quoted `cd <cwd> && claude` string. The user
  pastes this into a local terminal.
- `cwd` — the resolved absolute working directory. For `kind: 'exp'`,
  this is the project root (so the agent can see both
  `docs/experiments/` and `logs/`); for `kind: 'run'`, this is the
  run dir.
- `hint` — a one-sentence description naming the target (e.g.
  `"Edit docs/experiments/E0001-foo.md (experiment E0001-foo)"`),
  intended for a toast or console message.

The endpoint SHALL return:
- 400 BAD_REQUEST when the body fails the JSON schema
- 404 NOT_FOUND when the project is not configured, or the named
  experiment / run does not exist in the runtime index
- 200 OK with the response shape on success

The endpoint SHALL invoke `assertWithinProjectRoots()` on the
resolved cwd before returning, so a tampered runtime index can't
leak a path outside any configured project root.

#### Scenario: Resolve cwd for an experiment doc
- **WHEN** a client POSTs `{kind: 'exp', id: 'E0001-foo',
  projectName: 'project-a'}`
- **THEN** the response is 200 with `cwd` equal to the absolute
  path of `project-a`'s root, `command` starting with `cd ` and
  ending with `&& claude`, and `hint` mentioning the exp doc id

#### Scenario: Resolve cwd for a run
- **WHEN** a client POSTs `{kind: 'run', id: 'foo-260501-100000',
  projectName: 'project-a'}`
- **THEN** the response is 200 with `cwd` equal to the run dir's
  absolute path

#### Scenario: 404 on unknown id
- **WHEN** a client POSTs `{kind: 'exp', id: 'E9999-nope',
  projectName: 'project-a'}`
- **THEN** the response is 404 with `error.code: NOT_FOUND`

#### Scenario: 404 on unknown project
- **WHEN** a client POSTs with `projectName: 'no-such-project'`
- **THEN** the response is 404 with `error.code: NOT_FOUND`

### Requirement: `Open Claude Code` button consumes the resolve endpoint

Both the exp-level and run-panel `Open Claude Code` buttons SHALL
call `POST /api/open-claude-code` with the appropriate `kind` / `id`
/ `projectName` and copy `response.command` to the clipboard via
`navigator.clipboard.writeText`. A toast SHALL confirm the copy with
`response.hint` as its description.

If the clipboard write fails (browser policy / no
`navigator.clipboard`), the toast SHALL fall back to a `toast.message`
that displays the command inline so the user can copy it manually.

#### Scenario: Click copies the command
- **WHEN** the user clicks the exp-level `Open Claude Code` button
  on `/p/project-a/e/E0001-foo`
- **THEN** the client POSTs `/api/open-claude-code` with
  `{kind: 'exp', id: 'E0001-foo', projectName: 'project-a'}`,
  receives a `command` string, writes it to the clipboard, and
  shows a `toast.success` whose description is the response `hint`

#### Scenario: Clipboard-blocked fallback
- **GIVEN** `navigator.clipboard.writeText` rejects (e.g. sandbox
  policy)
- **WHEN** the user clicks `Open Claude Code`
- **THEN** the UI surfaces a `toast.message` with the command in
  its description so the user can copy it manually

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
  - A `<ChevronRight>` (collapsed) or `<ChevronDown>` (expanded) SHALL
    sit before the folder icon for any non-root directory row.
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
  the DOM); the chevron is `<ChevronRight>`; the folder icon is
  `<Folder>`

#### Scenario: Folder expanded by default when recursive count ≤ 10
- **GIVEN** a directory whose recursive descendant count is 7
- **WHEN** the tree first renders
- **THEN** the directory row is expanded (its children ARE in the
  DOM); the chevron is `<ChevronDown>`; the folder icon is
  `<FolderOpen>`

#### Scenario: Click toggles a folder's expand state
- **GIVEN** a folder collapsed by default (count 11)
- **WHEN** the user clicks anywhere on its row
- **THEN** the folder expands (chevron switches to ChevronDown,
  icon to FolderOpen, children render)
- **AND** clicking again collapses it back

