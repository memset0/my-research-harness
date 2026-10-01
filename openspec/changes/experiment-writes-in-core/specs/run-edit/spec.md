## ADDED Requirements

### Requirement: Run status writes maintain timestamps and the archived guard on every surface

A Run status change through `memon run status set` (and its deprecated
`memon experiment status set <run-id>` alias) or `PATCH /api/runs/:id/status`
SHALL apply the same document change:
- `status` is set to the requested value and `updated_at` is set to the
  current time with offset;
- `finished_at` is set to that time when the new status is `FINISHED` or
  `FAILED` and `finished_at` was null, and cleared to null when the new
  status is `RUNNING` or `PENDING`;
- every other frontmatter field and the body are preserved.

A request to set `RUNNING` on a Run whose README has `archived: true` SHALL
be refused without writing: the CLI exits 2 with `BAD_REQUEST`, the Web
answers 422 `ARCHIVE_RUNNING_FORBIDDEN`. A request whose status equals the
on-disk status remains an idempotent no-op even with a stale lock.

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
