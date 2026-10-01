## MODIFIED Requirements

### Requirement: `memon experiment status set` writes status + appends [EXP_STATUS] atomically

`memon experiment status set <exp-id-or-slug> --project-root <path> --to <STATUS> --expected-mtime <ms>` with an Experiment identifier (`E<NNNN>-<slug>` or a slug resolvable per `resolveExperimentId`) SHALL:
1. Resolve the Experiment and read its bundle README at `docs/experiments/E<NNNN>-<slug>/README.md`
2. Verify the README's mtime matches `--expected-mtime`; if not, exit 9 with `CONFLICT` and emit the current content to stdout
3. Apply `<STATUS>` (a value from the `ExperimentStatus` enum: `OPEN` / `RESOLVED` / `ABANDONED`) to the frontmatter, preserving every other frontmatter field and the body
4. Atomically write the README (temp file + rename), bumping `updated_at` to the current time with offset
5. When the status actually changed, record the transition (`<FROM>` → `<TO>`) as a detail of this invocation's automatic activity receipt per `journal`; the legacy `docs/journal.md` file SHALL NOT be appended to or rewritten
6. If the on-disk README has `archived: true`, emit the soft warning per `archive-frontmatter`

If `<STATUS>` is not in the `ExperimentStatus` enum, the command SHALL exit 2 with `BAD_REQUEST`. If the Experiment cannot be resolved, the command SHALL exit 4 with `NOT_FOUND`. A Run directory id (`<slug>-<YYMMDD>-<HHMMSS>`) SHALL instead be handled as the deprecated alias of `memon run status set` (with its deprecation banner); an identifier matching neither form SHALL exit 2 with `BAD_REQUEST`.

#### Scenario: Successful status set
- **GIVEN** an Experiment bundle `docs/experiments/E0001-zero-snr-fix/` whose README has `status: OPEN`
- **WHEN** the user runs `memon experiment status set E0001-zero-snr-fix --project-root <p> --to RESOLVED --expected-mtime <current>`
- **THEN** the bundle README's frontmatter has `status: RESOLVED` and a refreshed `updated_at`
- **AND** the invocation's activity receipt records the `OPEN` → `RESOLVED` transition for `E0001-zero-snr-fix`
- **AND** stdout is JSON containing `"ok":true`, the new `mtime`, `"prevStatus":"OPEN"` and `"nextStatus":"RESOLVED"`
- **AND** `docs/journal.md` is not modified

#### Scenario: Status unchanged → no JOURNAL event
- **WHEN** the requested status equals the current status
- **THEN** the README is rewritten (new mtime returned) but no status transition is recorded and `docs/journal.md` is not touched; stdout has `journalAppended: false`

#### Scenario: Out-of-enum value rejected
- **WHEN** the user runs `... --to CONCLUDED`
- **THEN** the command exits 2 with `BAD_REQUEST` naming the allowed values `OPEN`, `RESOLVED`, `ABANDONED`, and nothing is written

#### Scenario: Status set on archived exp emits warning
- **GIVEN** an Experiment README with `status: OPEN, archived: true`
- **WHEN** the user runs `memon experiment status set <id> --to ABANDONED --expected-mtime <current>`
- **THEN** stderr contains `warning: <id> is archived; modifying anyway`
- **AND** stdout JSON additionally contains `"warning":"archived"`
- **AND** the status transitions to ABANDONED

### Requirement: Web `PUT /api/experiments/:id/readme` accepts new fields

The endpoint SHALL accept exp doc content whose frontmatter includes the v4-canonical `status: <ExperimentStatus>` and `archived: <boolean>` fields and SHALL write it to the Experiment's bundle README `docs/experiments/E<NNNN>-<slug>/README.md`. The endpoint SHALL apply the soft-warning path per `archive-frontmatter` when the on-disk doc has `archived: true`. The endpoint SHALL NOT apply any hard-rule constraint between exp status and exp archive (the cannot-archive-RUNNING rule is run-specific).

The response body for a successful status-changing write SHALL include `prevStatus` and `nextStatus`. A write that changes the document SHALL record an automatic invocation receipt per `journal` and publish the `journal-change` event so subscribers can refresh diagnostic history; the legacy `docs/journal.md` file SHALL NOT be appended to.

#### Scenario: Successful write with status change
- **GIVEN** an exp doc on disk with `status: OPEN, archived: false`, `mtime: M0`
- **WHEN** the client sends new content with `status: ABANDONED, archived: false`, `expectedMtime: M0, expectedHash: H0`
- **THEN** the response is 200 with `{ ok: true, mtime: <new>, hash: <new>, finalContent: '...', prevStatus: 'OPEN', nextStatus: 'ABANDONED' }`
- **AND** an invocation receipt is recorded, a `journal-change` event is published, and `docs/journal.md` is unchanged

#### Scenario: Soft warning when archived
- **GIVEN** an exp doc with `archived: true`
- **WHEN** the client sends a body change
- **THEN** the response includes `warning: 'archived'` in addition to the success fields
- **AND** the web client surfaces a sonner toast

## REMOVED Requirements

### Requirement: `## Plan` section edits go through the existing markdown write path

**Reason**: `## Plan` is not part of the canonical v6 Experiment README section list (Motivation, Design, Implementation, Investigation, Results, Findings, Limitations, Conclusion, Warnings). A `## Plan` heading is now an unknown H2 that lint reports as an error while the content stays losslessly readable, so a dedicated Plan editing contract (including its "canonical position after Method") no longer describes any supported behavior.
**Migration**: Plan-like task lists belong in the structured `investigation.yaml` / `implementation.yaml` documents or in Design. A legacy `## Plan` body is preserved verbatim by the generic README write path (`Experiment doc write with optimistic mtime + content hash`) and surfaced by lint for the user to relocate.
