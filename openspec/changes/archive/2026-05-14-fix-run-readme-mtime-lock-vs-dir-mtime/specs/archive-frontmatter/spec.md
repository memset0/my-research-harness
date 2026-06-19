## MODIFIED Requirements

### Requirement: Archive subcommands write frontmatter atomically with mtime-lock + JOURNAL `[ARCHIVE]` event

`memon run archive <id>` / `memon run unarchive <id>` and the exp-side `memon experiment archive <id>` / `memon experiment unarchive <id>` SHALL:
1. Read the README / exp doc
2. Verify mtime against `--expected-mtime` if provided (otherwise use the just-read mtime); on mismatch, evaluate the idempotency rule below before returning a conflict
3. Compute the new frontmatter with `archived: <true|false>` (the operation's target)
4. Apply the hard rule from `Cannot set archived: true on a RUNNING run` if archiving a run
5. Apply the soft warning rule from `Soft warning on writes targeting an archived item` if the current state is already `archived: true`
6. Atomically write the new README / doc (temp file + rename), bumping `updated_at` to the operation's timestamp
7. Append a single `[ARCHIVE]` event to `JOURNAL.md` with body `\`<id>\` op=<archive|unarchive>` (paralleling existing `[BIND]` / `[STATUS]` event shape)
8. Print success JSON to stdout

For run-side archive, the `--expected-mtime` value SHALL be matched
against the run's `README.md` mtime in isolation — NOT against the
synthesized run-effective mtime from `run-discovery` (which is `max(dir,
README)`). The web client SHALL pass `run.readmeMtime` from the run
record when calling `PATCH /api/runs/:id/archive`; the CLI SHALL pass
the value returned by stat'ing `<runDir>/README.md` directly. For
exp-side archive, the exp doc's path IS the `.md` file so no such
disambiguation is needed.

**Idempotency on stale mtime when target already matches** — when the
provided `--expected-mtime` (or `expectedMtime` on the HTTP route)
does not match the on-disk README/doc mtime BUT the on-disk
`frontMatter.archived` already equals the requested operation's target,
the subcommand / route SHALL succeed with a noop response:
- CLI exits 0 with stdout `{"ok":true,"archived":<target>,"mtime":<n>,"noop":true}`
- HTTP route returns 200 with body `{ ok: true, archived: <target>, mtime: <n>, noop: true }`
- The README / doc is NOT rewritten (mtime not bumped)
- NO `[ARCHIVE]` event is appended

When `expectedMtime` is stale AND the on-disk archived value DIFFERS
from the requested target, the existing CONFLICT behavior applies
(HTTP 409 / CLI exit 9), with the current on-disk content returned in
the conflict payload so the client can rebase.

The `[ARCHIVE]` event SHALL NOT mention sidecar files (the v3 wording `\`<id>\` archived` referencing the sidecar is replaced by `\`<id>\` op=archive` in v4).

#### Scenario: Archive a run writes frontmatter and JOURNAL
- **GIVEN** a run `foo-260513-100000` with on-disk `archived: false, status: FINISHED`
- **WHEN** the user runs `memon run archive foo-260513-100000 --project-root <p>`
- **THEN** the run's README has `archived: true` in frontmatter (atomic write)
- **AND** README `updated_at` is bumped to the command's wall time
- **AND** `JOURNAL.md` has a new line `- <ISO> [ARCHIVE] \`foo-260513-100000\` op=archive`
- **AND** stdout is `{"ok":true,"archived":true,"mtime":<n>}`; exit 0

#### Scenario: Unarchive a run with no current archive is a no-op success
- **GIVEN** a run with `archived: false`
- **WHEN** the user runs `memon run unarchive <id>`
- **THEN** the command exits 0 with `{"ok":true,"archived":false,"noop":true}`
- **AND** README is unchanged (mtime not bumped)
- **AND** no `[ARCHIVE]` event is appended

#### Scenario: Archive an exp doc writes frontmatter and JOURNAL
- **GIVEN** an exp doc `E0001-zero-snr-fix` with on-disk `archived: false`
- **WHEN** the user runs `memon experiment archive E0001-zero-snr-fix --project-root <p>`
- **THEN** the doc's frontmatter has `archived: true` (atomic write)
- **AND** `JOURNAL.md` has a new line `- <ISO> [ARCHIVE] \`E0001-zero-snr-fix\` op=archive`
- **AND** stdout is `{"ok":true,"archived":true,"mtime":<n>}`; exit 0

#### Scenario: Run-dir activity does not block archive
- **GIVEN** a run with on-disk `archived: false, status: FINISHED`, and a
  log file inside the run dir was modified AFTER the README so that
  `dir.mtimeMs > README.mtimeMs`
- **WHEN** the web client (with `run.readmeMtime` from a fresh GET) calls
  `PATCH /api/runs/:id/archive { archived: true, expectedMtime:
  <run.readmeMtime> }`
- **THEN** the response is 200 with `{ ok: true, archived: true,
  mtime: <new> }`
- **AND** the README has `archived: true`
- **AND** `[ARCHIVE] op=archive` appears in JOURNAL

#### Scenario: Stale expectedMtime with matching target is idempotent
- **GIVEN** a run with on-disk `archived: true` (set by an earlier write)
- **WHEN** the client calls `PATCH /api/runs/:id/archive { archived:
  true, expectedMtime: <stale-value> }`
- **THEN** the response is 200 with `{ ok: true, archived: true,
  mtime: <on-disk-mtime>, noop: true }`
- **AND** no JOURNAL event is appended

#### Scenario: Stale expectedMtime with mismatching target still 409s
- **GIVEN** a run with on-disk `archived: true` (after a concurrent write)
- **WHEN** the client (whose view predates the concurrent write) calls
  `PATCH /api/runs/:id/archive { archived: false, expectedMtime:
  <stale-value> }`
- **THEN** the response is 409 with the current on-disk content / mtime
- **AND** the file is NOT rewritten
