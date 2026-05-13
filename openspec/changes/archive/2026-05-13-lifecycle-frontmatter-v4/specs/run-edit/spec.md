## ADDED Requirements

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
