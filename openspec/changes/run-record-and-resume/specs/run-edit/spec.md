## MODIFIED Requirements

### Requirement: CLI `memon run status set` accepts INTERRUPTED

`memon run status set <id> --to INTERRUPTED [--stop-reason <reason>] [--expected-mtime <ms>]` SHALL be a valid invocation, with `<reason>` one of `preempted`, `node_reclaimed`, `stage_target_reached`, `user_paused` or `unknown` (default `unknown`). The same atomic-write + JOURNAL-append + mtime-lock contract from the existing `memon run status set` requirement applies; only the accepted `--to` value set widens. `--stop-reason` with any other target status SHALL be rejected with `BAD_REQUEST`.

The CLI SHALL refuse `--to INTERRUPTED` when an explicit flag like `--from-log-analysis` (hypothetical) suggests automation — the user-facing CLI invocation IS the explicit human-write path per `archive-frontmatter`'s human-only rule, so no special automation gate is added; the rule is enforced by code review and the lack of any auto-derivation codepath, not by CLI flag. memon's launch wrapper and scheduler write `INTERRUPTED` through their own evidence-based paths (`run-launch`), never through log analysis.

When the target run has on-disk `archived: true`, the CLI SHALL emit the soft warning per `archive-frontmatter`'s soft-warning rule.

#### Scenario: Set INTERRUPTED on a RUNNING run
- **GIVEN** a run with `status: RUNNING, archived: false`
- **WHEN** the user runs `memon run status set <id> --to INTERRUPTED --expected-mtime <current>`
- **THEN** stdout JSON `{"ok":true,"mtime":<n>,"prevStatus":"RUNNING","nextStatus":"INTERRUPTED"}`
- **AND** README has `status: INTERRUPTED` and `stop_reason: unknown`
- **AND** JOURNAL has a `[STATUS] RUNNING → INTERRUPTED` line

#### Scenario: Set INTERRUPTED on archived run emits warning
- **GIVEN** a run with `status: FINISHED, archived: true`
- **WHEN** the user runs `memon run status set <id> --to INTERRUPTED --expected-mtime <current>`
- **THEN** stderr contains `warning: <id> is archived; modifying anyway`
- **AND** stdout JSON additionally contains `"warning":"archived"`
- **AND** the status transitions to INTERRUPTED

#### Scenario: Pause reason recorded by hand
- **WHEN** the user runs `memon run status set <id> --to INTERRUPTED --stop-reason user_paused --expected-mtime <current>`
- **THEN** README has `status: INTERRUPTED` and `stop_reason: user_paused`

### Requirement: Run status writes maintain timestamps and the archived guard on every surface

A Run status change through `memon run status set` (and its deprecated
`memon experiment status set <run-id>` alias) or `PATCH /api/runs/:id/status`
SHALL apply the same document change:
- `status` is set to the requested value and `updated_at` is set to the
  current time with offset;
- `finished_at` is set to that time when the new status is `FINISHED` or
  `FAILED` and `finished_at` was null, and cleared to null when the new
  status is `RUNNING` or `PENDING`;
- `stop_reason` is set to the requested reason (default `unknown`) when the
  new status is `INTERRUPTED` and cleared when it is any other status;
- the `launches` history and every other frontmatter field and the body are
  preserved — a manual status change never opens, completes or removes a
  launch entry.

A request to set `RUNNING` on a Run whose README has `archived: true` SHALL
be refused without writing: the CLI exits 2 with `BAD_REQUEST`, the Web
answers 422 `ARCHIVE_RUNNING_FORBIDDEN`. A request whose status equals the
on-disk status (and, for `INTERRUPTED`, whose reason equals the on-disk
reason) remains an idempotent no-op even with a stale lock.

#### Scenario: CLI finish stamps finished_at
- **GIVEN** a Run README with `status: RUNNING` and `finished_at: null`
- **WHEN** the user runs `memon run status set <id> --to FINISHED --expected-mtime <current>`
- **THEN** the README has `status: FINISHED`, a refreshed `updated_at`, and
  `finished_at` equal to that `updated_at`

#### Scenario: Restart clears finished_at
- **GIVEN** a Run README with `status: FAILED` and a non-null `finished_at`
- **WHEN** any surface sets its status to `RUNNING`
- **THEN** `finished_at` is null

#### Scenario: CLI refuses RUNNING on an archived Run
- **GIVEN** a Run README with `archived: true` and `status: FINISHED`
- **WHEN** the user runs `memon run status set <id> --to RUNNING --expected-mtime <current>`
- **THEN** the command exits 2 with `BAD_REQUEST` and the README is unchanged

#### Scenario: Leaving INTERRUPTED clears the reason
- **GIVEN** a Run with `status: INTERRUPTED` and `stop_reason: preempted`
- **WHEN** a human sets it to `FAILED`
- **THEN** `stop_reason` is null and the `launches` history is byte-identical
