## ADDED Requirements

### Requirement: Run README write with optimistic mtime + content hash

The system SHALL accept run README writes via `PUT /api/runs/:id/readme`
carrying `expectedMtime` (and optional `expectedHash`). The backend SHALL
compare both against the disk's current state before writing.

#### Scenario: Successful write
- **WHEN** `expectedMtime` and `expectedHash` match the on-disk values
- **THEN** the backend writes the new content, returns 200 with the new
  `mtime` + `hash`, and appends an event to JOURNAL.md

#### Scenario: Conflict on mtime
- **WHEN** the on-disk `mtime` differs from `expectedMtime`
- **THEN** the backend returns 409 with the current on-disk content,
  `mtime`, and `hash` so the client can rebase

#### Scenario: Conflict on hash with matching mtime
- **WHEN** `expectedMtime` matches but `expectedHash` does not
- **THEN** the backend returns 409 (defends against low-resolution mtime
  on NFS)

### Requirement: Frontend save handshake bumps `updated_at`

When the web markdown editor saves a run README, the frontend SHALL:
1. Capture `now()` as ISO8601 with the user's local timezone offset.
2. Rewrite the YAML frontmatter `updated_at` field in the editor buffer to
   that timestamp.
3. POST the new content to `PUT /api/runs/:id/readme` with `expectedMtime`
   and `expectedHash`.
4. On 200, replace the editor buffer with the response's `finalContent`
   and store the new `mtime`/`hash` for the next save.
5. On 409, restore the editor's prior `updated_at` value (visually) and
   surface the existing conflict-resolution UI.

The backend SHALL NOT auto-rewrite `updated_at` on its own; the frontmatter
field is whatever the request body carries. The `updated_at` value the
frontend writes IS the source of truth for "human last touched the doc."

#### Scenario: Save bumps updated_at and editor reflects new mtime
- **GIVEN** a run README with `updated_at: 2026-05-02T11:05:00+08:00` open
  in the web editor at `expectedMtime: M0`
- **WHEN** the user clicks Save at wall time `2026-05-04T09:30:15+08:00`
- **THEN** the POST body contains the editor content with
  `updated_at: 2026-05-04T09:30:15+08:00` baked into the YAML
- **AND** on 200, the editor displays the same content and stores the
  returned `mtime` as its new `expectedMtime`

#### Scenario: 409 rolls back the editor's updated_at bump
- **GIVEN** the editor has bumped `updated_at` to `<save-time>` and posted
  the content
- **WHEN** the backend returns 409
- **THEN** the editor restores `updated_at` to its pre-save value before
  showing the conflict-resolution UI; the user sees their original
  buffer state

### Requirement: `memon run rename` only changes the slug

The CLI SHALL expose `memon run rename <run-id-or-dir> <new-slug>
[--project-root <p>]`. The command SHALL:
1. Locate the run dir (by exact dir name or by id).
2. Validate `<new-slug>` is `[a-z0-9-]+` and contains no timestamp suffix.
3. Compute the new dir name as `<new-slug>-<YYMMDD>-<HHMMSS>` reusing the
   run's existing timestamp.
4. Check that no other run in the project has the new slug
   (`DUPLICATE_RUN_SLUG` collision).
5. If the run has a parent experiment (`experiment:` field set), update
   that experiment's `runs[]` array atomically — replace the old dir name
   with the new dir name. If the run claims experiment `E_a` but `E_a`'s
   `runs[]` does NOT list this run (a `MISMATCH_EXPERIMENT_REF` anomaly),
   the rename SHALL fail with `BAD_STATE` and instruct the user to
   reconcile the binding first.
6. `git mv` (or `fs.rename`) the directory.
7. Update the run README's frontmatter `id` field to the new dir name.
8. Append a `[RENAME]` event to JOURNAL with body `{old, new}`.

The command SHALL NOT touch the run's timestamp suffix. It SHALL NOT
change `created_at` or `updated_at` (the rename is a naming op, not a
content edit). It SHALL NOT update the parent experiment's `updated_at`.

The command SHALL warn but not block if the soft prefix rule is violated
(experiment slug is a prefix of the new run slug). The warning is to
stderr; exit code 0.

#### Scenario: Rename updates experiment back-reference
- **GIVEN** a run `foo-260501-100000` with `experiment: E0001-foo` and
  `E0001-foo.runs: ["foo-260501-100000"]`
- **WHEN** the user runs `memon run rename foo-260501-100000 foo-baseline`
- **THEN** the dir is now `foo-baseline-260501-100000`,
  `E0001-foo.runs` is `["foo-baseline-260501-100000"]`, and a `[RENAME]`
  event is appended to JOURNAL

#### Scenario: Slug collision rejected
- **GIVEN** runs `foo-260501-100000` and `bar-260502-100000` exist
- **WHEN** the user runs `memon run rename bar-260502-100000 foo`
- **THEN** the command exits with `DUPLICATE_RUN_SLUG`, no filesystem
  changes occur

#### Scenario: Anomaly state blocks rename
- **GIVEN** a run claims `experiment: E0001-foo` but `E0001-foo.runs[]`
  does not list it (a `MISMATCH_EXPERIMENT_REF`)
- **WHEN** the user attempts `memon run rename` on this run
- **THEN** the command exits with `BAD_STATE` and stderr names the
  anomaly; the user must reconcile via `memon experiment link/unlink`
  first

#### Scenario: Soft prefix violation warns but proceeds
- **GIVEN** a run `foo-260501-100000` whose parent experiment is
  `E0001-zero-snr-fix` (slug `zero-snr-fix`)
- **WHEN** the user runs `memon run rename foo-260501-100000
  cfg-rescale-baseline`
- **THEN** the rename proceeds (exit 0); stderr contains a non-blocking
  warning that `cfg-rescale-baseline` does not start with the experiment
  slug `zero-snr-fix`

### Requirement: Run-side warnings do not exist in v3

A run README in v3 SHALL NOT contain a `## Warnings` section. The exp
doc owns the warnings table (with a `Run` column to attribute origin).
Any `## Warnings` section appearing in a run README SHALL surface a
`LEGACY_SECTION_IN_RUN` warning per `run-readme` and the body SHALL be
preserved verbatim until the user moves it; section-bound writers SHALL
NOT mutate it.

CLI flow: `memon experiment warning add/resolve/reopen/delete` is the
only path; it accepts a `--run <run-dir>` flag to populate the `Run`
column on the row.

#### Scenario: Run README with warnings section is flagged
- **GIVEN** a v2-style run README that still has `## Warnings` body
- **WHEN** the parser indexes it
- **THEN** the index entry has a `LEGACY_SECTION_IN_RUN` warning, and the
  experiment-side warnings table is unaffected by the run's old rows
