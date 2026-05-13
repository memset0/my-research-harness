## ADDED Requirements

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
