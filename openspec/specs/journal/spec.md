# journal Specification

## Purpose
TBD - created by archiving change add-memon-mvp. Update Purpose after archive.
## Requirements
### Requirement: JOURNAL.md location

Each project SHALL have at most one `journal.md` file at `<root>/docs/journal.md` (lowercase filename, inside the project's `docs/` subdirectory). The file is an append-only event log for that project. The legacy v1 location (`<root>/JOURNAL.md`, ALL-CAPS, at the project root) is NOT a valid v2 location; v1 projects SHALL be migrated via `memon-migrate-fs` (driven by `packages/core/migrations/v1-to-v2.md`) before memon will read or write the journal under v2.

#### Scenario: File at canonical v2 path
- **WHEN** a project root is `/mnt/p` and `/mnt/p/docs/journal.md` exists
- **THEN** the system reads/writes events through that file

#### Scenario: File missing on first write
- **WHEN** the system needs to append the first event for a project that has no `docs/journal.md`
- **THEN** the system creates the `docs/` directory if absent, then creates `docs/journal.md` with an initial frontmatter block (`last_digest_at: null`) before appending

#### Scenario: v1 path is not a fallback
- **GIVEN** a project root that has `<root>/JOURNAL.md` (legacy v1 location) but no `<root>/docs/journal.md`
- **WHEN** memon attempts to read the journal under v2
- **THEN** memon SHALL treat the file as missing and SHALL NOT silently fall back to the v1 path
- **AND** the user SHALL be steered to `memon-migrate-fs` via the install-time version-mismatch banner from `fs-migration-runtime`

### Requirement: Frontmatter `last_digest_at` field

`JOURNAL.md` SHALL begin with a YAML front matter block containing exactly one field: `last_digest_at`. The value is either `null` or an ISO8601 timestamp with timezone offset.

#### Scenario: Frontmatter present
- **WHEN** the file begins with `---\nlast_digest_at: 2026-05-03T10:00:00+08:00\n---`
- **THEN** the parser exposes `lastDigestAt` as that timestamp

#### Scenario: Frontmatter missing
- **WHEN** the file body has events but no frontmatter block
- **THEN** the parser treats `lastDigestAt` as `null` and surfaces a warning to the frontend

### Requirement: Event line format

Each event SHALL be a single markdown list line of the form:

`- <ISO8601 with offset> [TAG] <body>`

Where `TAG` is one of an extensible set: `CREATE`, `STATUS`, `NOTE`, `REQUEST`, `ARCHIVE`, `ERROR`. Body content depends on tag:

- `[CREATE] \`<exp-id>\` <STATUS>` — experiment created with initial status
- `[STATUS] \`<exp-id>\` <FROM> → <TO>` — status transition
- `[NOTE]   \`<exp-id>\` <free text>` — human/agent note
- `[REQUEST] <free text>` — user request for an agent to act on
- `[ARCHIVE] \`<exp-id>\`` — experiment archived
- `[ERROR]  <free text>` — system or experiment error

#### Scenario: Status transition appended
- **WHEN** an experiment's `status` changes from `RUNNING` to `FINISHED`
- **THEN** a new line `- 2026-05-03T09:45:00+08:00 [STATUS] \`foo-260503-082800\` RUNNING → FINISHED` is appended to `JOURNAL.md` with the current ISO8601 + local timezone timestamp

#### Scenario: Free-form NOTE
- **WHEN** the user adds a note "converged faster than expected" to an experiment via the web UI
- **THEN** a new line tagged `[NOTE]` is appended with the experiment ID and the note body

### Requirement: Status changes are atomic README + JOURNAL writes

Whenever the system changes an experiment's `status` (whether from CLI, web UI, or agent through `memon`'s API), it SHALL update the README front matter AND append a corresponding `[STATUS]` line to `JOURNAL.md` as an atomic pair (both succeed or both roll back).

#### Scenario: README write fails
- **WHEN** the README write fails (permission denied, disk full, etc.) after `JOURNAL.md` was already appended
- **THEN** the appended `JOURNAL.md` line is removed (truncate to prior length) and the error is propagated

#### Scenario: JOURNAL write fails
- **WHEN** the README write succeeds but the `JOURNAL.md` append fails
- **THEN** the README write is reverted to its prior content and the error is propagated

### Requirement: Digest protocol

A digest agent SHALL only consume events with timestamp strictly greater than `last_digest_at`. After completing its digest, the agent SHALL update `last_digest_at` to the timestamp of the most recent event it processed.

#### Scenario: Reading new events
- **WHEN** an agent runs a digest and `last_digest_at` is `2026-05-03T10:00:00+08:00`
- **THEN** the agent only considers event lines whose timestamp is `> 2026-05-03T10:00:00+08:00`

#### Scenario: Updating last_digest_at
- **WHEN** the agent finishes processing through event timestamp `2026-05-03T11:00:00+08:00`
- **THEN** the agent rewrites the frontmatter `last_digest_at: 2026-05-03T11:00:00+08:00` and writes the file back atomically (write-temp-then-rename)

### Requirement: `last_digest_at` write protection for non-digest writers

CLI, web UI, and agent code paths that append events SHALL NOT modify `last_digest_at`. Only the digest agent has authority to update it.

#### Scenario: Append-only writer
- **WHEN** `memon` CLI or the web backend appends a `[STATUS]` event
- **THEN** the write only adds a line to the body and does not touch the frontmatter block

#### Scenario: Detect tampering
- **WHEN** any non-digest writer attempts to update the frontmatter
- **THEN** the operation is rejected with an explicit error

### Requirement: New event tags for experiment, binding, and rename

The journal event grammar SHALL accept these new tags in addition to the
v2 set:

- `[EXPERIMENT]` — emitted by `memon experiment create`,
  `memon experiment delete`, and exp-doc edits via the web UI. Body
  format: `\`<E-id>\` op=<create|edit|delete> [extra-fields]`. For
  `op=delete`, extra fields include the prior `runs[]` payload so the
  binding can be reconstructed if needed.
- `[BIND]` — emitted by `memon experiment link` /
  `memon experiment unlink` (also dispatched when the web UI's `Link
  to experiment` action runs). Body format: `\`<E-id>\` op=<link|unlink>
  run=<run-dir-name>`.
- `[RENAME]` — emitted by `memon run rename`. Body format: `op=run-
  rename old=<old-dir-name> new=<new-dir-name>`.

The `[WARNING]` event continues from v2 with one schema change: the
event body SHALL include a `run=<run-dir-name-or-null>` token to
attribute the warning to a specific run when applicable.

#### Scenario: EXPERIMENT create event
- **WHEN** `memon experiment create zero-snr-fix` succeeds
- **THEN** JOURNAL.md gains one new line: `- <ISO> [EXPERIMENT]
  \`E0001-zero-snr-fix\` op=create slug=zero-snr-fix`

#### Scenario: BIND link event
- **WHEN** `memon experiment link E0001-zero-snr-fix
  bar-260501-100000` succeeds
- **THEN** JOURNAL.md gains one new line: `- <ISO> [BIND]
  \`E0001-zero-snr-fix\` op=link run=bar-260501-100000`

#### Scenario: RENAME event
- **WHEN** `memon run rename foo-260501-100000 baz` succeeds (foo →
  baz, timestamp preserved)
- **THEN** JOURNAL.md gains one new line: `- <ISO> [RENAME] op=run-
  rename old=foo-260501-100000 new=baz-260501-100000`

#### Scenario: WARNING event includes run attribution
- **WHEN** `memon experiment warning add E0001-foo --run bar-260501-100000
  --category result --message "..."` succeeds
- **THEN** JOURNAL.md gains a `[WARNING]` line whose body includes
  `\`E0001-foo\` op=add rowId=<id> run=bar-260501-100000 category=result
  message="..."`

#### Scenario: WARNING event for exp-scoped warning has run=null
- **WHEN** the same command runs without `--run`
- **THEN** the `[WARNING]` event body includes `run=null` (or the
  literal token `run=—` per implementation choice; consumers parse
  either form)

