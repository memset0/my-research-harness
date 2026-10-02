## MODIFIED Requirements

### Requirement: CLI `memon run status set` accepts INTERRUPTED

`memon run status set <id> --to INTERRUPTED [--stop-reason <reason>] [--evidence <text>] [--expected-mtime <ms>]` SHALL be a valid invocation, with `<reason>` one of `preempted`, `node_reclaimed`, `stage_target_reached`, `user_paused` or `unknown` (default `unknown`) and `<text>` a one-line statement of the basis for the classification. The same atomic-write + JOURNAL-append + mtime-lock contract from the existing `memon run status set` requirement applies; only the accepted `--to` value set widens. `--stop-reason` or `--evidence` with any other target status SHALL be rejected with `BAD_REQUEST`. When the Run's current status is `FAILED`, `--to INTERRUPTED` SHALL require `--evidence` and SHALL be rejected with `BAD_REQUEST` naming `--evidence` without it, so that every reclassification of a failure records its basis.

The CLI SHALL refuse `--to INTERRUPTED` when an explicit flag like `--from-log-analysis` (hypothetical) suggests automation — the user-facing CLI invocation IS the explicit human-write path per `archive-frontmatter`'s human-only rule, so no special automation gate is added; the rule is enforced by code review and the lack of any auto-derivation codepath, not by CLI flag. memon's launch wrapper and scheduler write `INTERRUPTED` through their own evidence-based paths (`run-launch`), never through log analysis. An agent's reclassification of a `FAILED` Run is such an explicit invocation: it follows the evidence procedure of `memon-skills` and records its basis with `--evidence`.

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

#### Scenario: Reclassifying a failure needs evidence
- **GIVEN** a Run with `status: FAILED`
- **WHEN** the user runs `memon run status set <id> --to INTERRUPTED --stop-reason node_reclaimed --expected-mtime <current>`
- **THEN** the command exits 2 with `BAD_REQUEST` naming `--evidence` and the README is unchanged

#### Scenario: Reclassification records its basis
- **GIVEN** a Run with `status: FAILED`, a non-null `finished_at` and a last launch that ended with signal `SIGKILL`
- **WHEN** `memon run status set <id> --to INTERRUPTED --stop-reason node_reclaimed --evidence "SIGKILL without a traceback; the node's other Runs stopped in the same minute" --expected-mtime <current>` runs
- **THEN** the README has `status: INTERRUPTED`, `stop_reason: node_reclaimed`, that `stop_evidence` and `finished_at: null`
- **AND** the `launches` history is byte-identical, its last entry still recording outcome `FAILED` and signal `SIGKILL`

### Requirement: Run status writes maintain timestamps and the archived guard on every surface

A Run status change through `memon run status set` (and its deprecated
`memon experiment status set <run-id>` alias) or `PATCH /api/runs/:id/status`
SHALL apply the same document change:
- `status` is set to the requested value and `updated_at` is set to the
  current time with offset;
- `finished_at` is set to that time when the new status is `FINISHED` or
  `FAILED` and `finished_at` was null, and cleared to null when the new
  status is `RUNNING`, `PENDING` or `INTERRUPTED`;
- `stop_reason` is set to the requested reason (default `unknown`) and
  `stop_evidence` to the supplied evidence (null when none is supplied) when
  the new status is `INTERRUPTED`, and both are cleared when it is any other
  status;
- the `launches` history and every other frontmatter field and the body are
  preserved — a manual status change never opens, completes or removes a
  launch entry.

A request to set `RUNNING` on a Run whose README has `archived: true` SHALL
be refused without writing: the CLI exits 2 with `BAD_REQUEST`, the Web
answers 422 `ARCHIVE_RUNNING_FORBIDDEN`. A request whose status equals the
on-disk status (and, for `INTERRUPTED`, whose reason and evidence equal the
on-disk values) remains an idempotent no-op even with a stale lock.

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
- **THEN** `stop_reason` and `stop_evidence` are null and the `launches` history is byte-identical
