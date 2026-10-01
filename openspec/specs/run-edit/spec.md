# run-edit Specification

## Purpose
Defines the write paths for Run READMEs: optimistic-locked README writes from the dashboard, idempotent status and archive routes, the `updated_at` save handshake, `memon run rename` and `memon run status set`, and the rule that Runs store no warnings of their own. It serves both dashboard editors and agents driving Runs from the CLI. Run README files are the source of truth; writes go through `@memon/core`, `packages/cli` and `packages/backend`.

## Requirements

### Requirement: Run README write with optimistic mtime + content hash

The system SHALL accept run README writes via `PUT /api/runs/:id/readme`
carrying `expectedMtime` (and optional `expectedHash`). The backend SHALL
compare both against the disk's current state before writing.

**The `expectedMtime` value SHALL be the README.md file's mtime in
isolation — NOT the synthesized run-effective mtime from `run-discovery`
(which is `max(dir, README)`).** The web client SHALL pass
`run.readmeMtime` from the run record; the CLI SHALL pass the value
returned by stat'ing the README.md file directly. The server SHALL
compare `expectedMtime` against `fs.stat(<runDir>/README.md).mtimeMs`
ONLY; the run dir's own mtime SHALL be irrelevant to the lock decision.

#### Scenario: Successful write
- **WHEN** `expectedMtime` and `expectedHash` match the on-disk values
- **THEN** the backend writes the new content, returns 200 with the new
  `mtime` + `hash`, and appends an event to JOURNAL.md

#### Scenario: Conflict on mtime
- **WHEN** the on-disk README's `mtime` differs from `expectedMtime`
  AND the canonical re-serialization of the request `content` differs
  from the canonical re-serialization of the on-disk content
- **THEN** the backend returns 409 with the current on-disk content,
  `mtime`, and `hash` so the client can rebase

#### Scenario: Conflict on hash with matching mtime
- **WHEN** `expectedMtime` matches but `expectedHash` does not
- **THEN** the backend returns 409 (defends against low-resolution mtime
  on NFS)

#### Scenario: Stale mtime with identical content is idempotent
- **GIVEN** an on-disk README at mtime `M1` whose canonical re-serialization
  hash is `H1`
- **WHEN** the client POSTs new content whose canonical re-serialization
  hash also equals `H1`, with `expectedMtime: M0` (where `M0 < M1` —
  client view is stale)
- **THEN** the backend returns 200 with `{ ok: true, mtime: M1, hash: H1,
  finalContent: <on-disk-content> }`
- **AND** the file is NOT rewritten (no mtime bump)
- **AND** NO `[STATUS]` / `[ARCHIVE]` JOURNAL event is appended
- **AND** the client uses the response as its new editor baseline

#### Scenario: Run-dir activity does not invalidate the README lock
- **GIVEN** a run README written at `M_readme` and the run dir touched
  by an artifact write at `M_dir` with `M_dir > M_readme`, both
  observed by discovery so `run.mtime === M_dir`, `run.readmeMtime ===
  M_readme`
- **WHEN** the client POSTs a README write with `expectedMtime: M_readme`
- **THEN** the backend stats `<runDir>/README.md`, sees `M_readme`, and
  proceeds with the write (succeeds 200)
- **AND** the run dir's mtime is irrelevant to the decision

### Requirement: Run archive route is idempotent on stale mtime when target matches on-disk state

`PATCH /api/runs/:id/archive` SHALL gracefully handle the case where the
client's `expectedMtime` is stale relative to the on-disk README.md but
the on-disk frontmatter already has `archived: <requested-target>`.

Concretely, when:
1. `expectedMtime` is provided AND `expectedMtime !== stat.mtimeMs`, AND
2. the on-disk parsed `frontMatter.archived` equals the request body's
   `archived` field,

the backend SHALL return 200 with `{ ok: true, archived: <target>,
mtime: <current on-disk mtime>, noop: true }`. The file SHALL NOT be
rewritten and no `[ARCHIVE]` JOURNAL event SHALL be appended.

When the on-disk archived state DIFFERS from the requested target AND
the mtime is stale, the backend SHALL continue to return 409 with the
current on-disk content, mtime, and hash (the existing conflict
behavior).

#### Scenario: Archive request races with a poll that bumped run.mtime
- **GIVEN** a run with on-disk `archived: false`, README mtime `M_readme`,
  and `run.mtime === M_dir > M_readme` (the synthesized dir-effective mtime)
- **WHEN** a misbehaving client posts `PATCH /api/runs/:id/archive` with
  `{ archived: true, expectedMtime: M_dir }` (the WRONG key)
- **AND** the on-disk README still has `archived: false`
- **THEN** the response is 409 with the current README content
  (since the target `archived: true` does NOT match the on-disk `false`)

#### Scenario: Double-archive resolves to noop on stale mtime
- **GIVEN** two clients both view a run with `archived: false`
- **WHEN** client A archives it (`archived: true`), bumping the on-disk
  mtime, AND immediately after, client B sends
  `PATCH .../archive { archived: true, expectedMtime: <pre-archive mtime> }`
- **THEN** client B receives 200 with `{ ok: true, archived: true,
  mtime: <post-A mtime>, noop: true }`
- **AND** the README is not rewritten by client B's call
- **AND** at most one `[ARCHIVE] op=archive` event exists in JOURNAL

### Requirement: Run status route is idempotent on stale mtime when target matches on-disk state

`PATCH /api/runs/:id/status` SHALL gracefully handle the case where the
client's `expectedMtime` is stale but the on-disk frontmatter's `status`
already equals the requested `status`.

Concretely, when:
1. `expectedMtime !== stat.mtimeMs`, AND
2. the on-disk parsed `frontMatter.status` equals the request body's
   `status` field,

the backend SHALL return 200 with `{ ok: true, status: <target>,
mtime: <current on-disk mtime>, noop: true }`. The file SHALL NOT be
rewritten and no `[STATUS]` JOURNAL event SHALL be appended.

When the on-disk status DIFFERS from the requested target AND the mtime
is stale, the backend SHALL continue to return 409.

#### Scenario: Status transition on stale mtime is idempotent when target already set
- **GIVEN** a run with on-disk `status: FINISHED` and a client view that
  predates the most recent README rewrite (`expectedMtime: M0 < M_readme`)
- **WHEN** the client posts `PATCH .../status { status: 'FINISHED',
  expectedMtime: M0 }`
- **THEN** the response is 200 with `{ ok: true, status: 'FINISHED',
  mtime: M_readme, noop: true }`
- **AND** no `[STATUS]` event is appended to JOURNAL

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
4. Check that no other run in the project ALREADY HAS THE SAME DIR NAME
   (which can only happen if some other run has both this slug AND this
   exact timestamp suffix). On collision, exit with the `DUPLICATE_RUN_DIR`
   error code. Run slugs themselves MAY repeat across different
   timestamps — the timestamp suffix already disambiguates the dir
   name, so a slug-only check would reject legitimate reruns.
5. If an Experiment declares the run, replace the old project-relative
   path with the new one in that Experiment's `runs[]` and in its
   `results.yaml` Variant `runs`/`attempts`, re-reading the Experiment
   after the directory move so concurrent edits are not replaced. The
   owner is derived from Experiment declarations only; when more than one
   Experiment declares the run, or the owner lists it only by a legacy
   bare ID, the rename SHALL fail with `BAD_STATE` and instruct the user
   to reconcile the declarations first.
6. `git mv` (or `fs.rename`) the directory.
7. Update the run README's frontmatter `id` field to the new dir name.
8. Append a `[RENAME]` event to JOURNAL with body `{old, new}`.

The command SHALL NOT touch the run's timestamp suffix. It SHALL NOT
change `created_at` or `updated_at` (the rename is a naming op, not a
content edit). Rewriting the declaring Experiment's `runs[]` bumps that Experiment's
`updated_at` like any other declaration edit.

The command SHALL warn but not block if the soft prefix rule is violated
(experiment slug is a prefix of the new run slug). The warning is to
stderr; exit code 0.

#### Scenario: Rename updates experiment back-reference
- **GIVEN** a run `logs/foo-260501-100000` and
  `E0001-foo.runs: ["logs/foo-260501-100000"]`
- **WHEN** the user runs `memon run rename foo-260501-100000 foo-baseline`
- **THEN** the dir is now `logs/foo-baseline-260501-100000`,
  `E0001-foo.runs` is `["logs/foo-baseline-260501-100000"]`, and a `[RENAME]`
  event is recorded

#### Scenario: Dir-name collision rejected
- **GIVEN** runs `foo-260501-100000` and `bar-260501-100000` exist
  (same timestamp, different slug)
- **WHEN** the user runs `memon run rename bar-260501-100000 foo`
- **THEN** the command exits with `DUPLICATE_RUN_DIR`, no filesystem
  changes occur

#### Scenario: Slug repeat across timestamps is OK
- **GIVEN** runs `foo-260501-100000` and `bar-260502-100000` exist
- **WHEN** the user runs `memon run rename bar-260502-100000 foo`
- **THEN** the command succeeds and the dir is now
  `foo-260502-100000` — the slug "foo" now appears twice in the
  project at distinct timestamps, which is allowed

#### Scenario: Anomaly state blocks rename
- **GIVEN** both `E0001-foo.runs[]` and `E0002-bar.runs[]` declare the
  run (a `MISMATCH_EXPERIMENT_REF`)
- **WHEN** the user attempts `memon run rename` on this run
- **THEN** the command exits with `BAD_STATE` and stderr names the
  conflict; the user must reconcile via `memon experiment unlink`
  first

### Requirement: Run README write accepts INTERRUPTED and the new archived field

`PUT /api/runs/:id/readme` SHALL accept run README content whose frontmatter includes `status: INTERRUPTED` (a v4-canonical value) and `archived: <boolean>` per `archive-frontmatter`. The endpoint SHALL apply the `archive-frontmatter` rules at write time:
- If the new content has `archived: true` AND the new content's `status` (after applying the same write) is `RUNNING`, the endpoint SHALL refuse with HTTP 422 `code: 'ARCHIVE_RUNNING_FORBIDDEN'` per `archive-frontmatter`'s "Cannot set archived: true on a RUNNING run" requirement.
- If the on-disk current state has `archived: true`, the endpoint SHALL still attempt the write (the soft-warning path), and on 200 the response body SHALL include `warning: 'archived'`.

#### Scenario: Successful write with status INTERRUPTED
- **GIVEN** a run README on disk with `status: RUNNING, archived: false` and current `mtime: M0`
- **WHEN** the client POSTs new content with `status: INTERRUPTED, archived: false` and `expectedMtime: M0, expectedHash: H0`
- **THEN** the response is 200 with `{ ok: true, mtime: <new>, hash: <new>, finalContent: '...' }`
- **AND** the README on disk has `status: INTERRUPTED`
- **AND** a `[STATUS] RUNNING → INTERRUPTED` JOURNAL event is appended

#### Scenario: Refuse archive-on-RUNNING attempt
- **GIVEN** a run with on-disk `status: RUNNING, archived: false`
- **WHEN** the client POSTs new content with `status: RUNNING, archived: true`
- **THEN** the response is 422 with `{ error: { code: 'ARCHIVE_RUNNING_FORBIDDEN', message: '...', id: '...' } }`
- **AND** the README on disk is unchanged

#### Scenario: Status-and-archive-together transition succeeds when post-write status is non-RUNNING
- **GIVEN** a run with on-disk `status: RUNNING, archived: false`
- **WHEN** the client POSTs new content with `status: INTERRUPTED, archived: true`
- **THEN** the response is 200 (the post-write status is no longer RUNNING; the archive-on-RUNNING rule does not apply)
- **AND** the README on disk has `status: INTERRUPTED, archived: true`
- **AND** both `[STATUS] RUNNING → INTERRUPTED` and `[ARCHIVE] op=archive` JOURNAL events are appended

#### Scenario: Soft warning surfaces when on-disk is already archived
- **GIVEN** a run with on-disk `archived: true, status: FINISHED`
- **WHEN** the client POSTs a body change (any field) with `expectedMtime` matching
- **THEN** the response is 200 with body `{ ok: true, mtime: <n>, hash: <h>, warning: 'archived', ... }`
- **AND** the web client surfaces a sonner toast `warning: <id> is archived; modifying anyway`

### Requirement: CLI `memon run status set` accepts INTERRUPTED

`memon run status set <id> --to INTERRUPTED [--expected-mtime <ms>]` SHALL be a valid invocation. The same atomic-write + JOURNAL-append + mtime-lock contract from the existing `memon run status set` requirement applies; only the accepted `--to` value set widens.

The CLI SHALL refuse `--to INTERRUPTED` when an explicit flag like `--from-log-analysis` (hypothetical) suggests automation — the user-facing CLI invocation IS the explicit human-write path per `archive-frontmatter`'s human-only rule, so no special automation gate is added; the rule is enforced by code review and the lack of any auto-derivation codepath, not by CLI flag.

When the target run has on-disk `archived: true`, the CLI SHALL emit the soft warning per `archive-frontmatter`'s soft-warning rule.

#### Scenario: Set INTERRUPTED on a RUNNING run
- **GIVEN** a run with `status: RUNNING, archived: false`
- **WHEN** the user runs `memon run status set <id> --to INTERRUPTED --expected-mtime <current>`
- **THEN** stdout JSON `{"ok":true,"mtime":<n>,"prevStatus":"RUNNING","nextStatus":"INTERRUPTED"}`
- **AND** README has `status: INTERRUPTED`
- **AND** JOURNAL has a `[STATUS] RUNNING → INTERRUPTED` line

#### Scenario: Set INTERRUPTED on archived run emits warning
- **GIVEN** a run with `status: FINISHED, archived: true`
- **WHEN** the user runs `memon run status set <id> --to INTERRUPTED --expected-mtime <current>`
- **THEN** stderr contains `warning: <id> is archived; modifying anyway`
- **AND** stdout JSON additionally contains `"warning":"archived"`
- **AND** the status transitions to INTERRUPTED

### Requirement: Runs store no warnings; run warning add writes through to the parent Experiment

Runs SHALL NOT store warnings. Warnings about a Run SHALL live in the parent Experiment's `## Warnings` table, attributed through its `Run` column. memon writers (CLI, Web, backend) SHALL NOT create, append to, or mutate a `## Warnings` section in a Run README. A legacy `## Warnings` section that still exists in a Run README SHALL be preserved verbatim and SHALL NOT be merged into, or alter, the parent Experiment's warnings table.

`memon run warning add <run-id-or-dir> --category C --message M` SHALL remain a compatibility entry that writes through to the parent Experiment:
- it resolves the Run, then resolves its parent Experiment from the Experiment declarations (per FS v7 membership), and performs the same write as `memon experiment warning add <exp> --run <run-dir> --category C --message M`, including the optional `--expected-mtime` / `--expected-hash` lock on the Experiment README;
- it prints exactly one non-suppressible `[deprecated]` notice on stderr directing Agents to maintain Warnings through `memon-write-experiment-doc`, the same notice every `memon experiment warning …` invocation prints;
- an orphan Run (no declaring Experiment) SHALL fail with `BAD_STATE` (exit 1) naming `memon experiment link` as the unblock command and SHALL write nothing;
- an unknown Run SHALL fail with `NOT_FOUND` (exit 4).

#### Scenario: Run warning add writes through to the parent Experiment
- **GIVEN** Run `bar-260501-100000` declared by Experiment `E0002-bar`
- **WHEN** the user runs `memon run warning add bar-260501-100000 --category data --message "shard 3 truncated"`
- **THEN** a new row with Run cell `bar-260501-100000` is appended to `E0002-bar`'s `## Warnings` table
- **AND** the Run README is not modified
- **AND** stderr contains exactly one `[deprecated]` notice

#### Scenario: Orphan run is refused
- **GIVEN** a Run that no Experiment declares
- **WHEN** the user runs `memon run warning add <run> --category other --message m`
- **THEN** the command exits 1 with `BAD_STATE` naming `memon experiment link`, and no file is written

#### Scenario: Legacy Run warnings section is left untouched
- **GIVEN** a v2-style Run README that still has a `## Warnings` body
- **WHEN** the Run is indexed, or its status or archived flag is changed through a memon writer
- **THEN** the `## Warnings` body is preserved verbatim
- **AND** the parent Experiment's warnings table is unaffected by the Run's old rows
