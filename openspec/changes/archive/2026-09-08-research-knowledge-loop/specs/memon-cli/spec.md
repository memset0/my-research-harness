## ADDED Requirements

### Requirement: Project scan excludes diagnostic history

The CLI SHALL return the existing project, scan-time, run/experiment and hypothesis snapshot fields without a journal field. Default scan SHALL NOT read legacy Journal files or activity receipts. Human output SHALL not report a digest cursor. Diagnostic history SHALL be queried explicitly through journal read, not embedded into normal scans.

#### Scenario: Scan without Journal permissions
- **GIVEN** research documents are readable but diagnostic history is unavailable
- **WHEN** the user runs a normal scan
- **THEN** the research snapshot succeeds without reading diagnostic history or inserting a fake empty journal object

### Requirement: Journal diagnostic query uses typed filters and stable paging

`memon journal read` SHALL provide explicit diagnostic history with AND-composed `--since`, `--tag`, `--experiment-id`, `--run-id`, `--limit` and opaque `--cursor` filters. Default limit SHALL be 200 and maximum 1000. Timestamps SHALL compare as instants across timezone offsets. Output SHALL include events, nextCursor and origin/typed association information, not an active lastDigestAt. Experiment IDs and Run IDs SHALL be validated separately; a run-shaped experiment-id SHALL fail with an actionable run-id hint. Stable pagination SHALL not skip tied timestamps.

#### Scenario: Entity filtering is real
- **GIVEN** history contains operations for E0001 and E0002
- **WHEN** journal read filters E0001
- **THEN** no E0002-only operation is returned

#### Scenario: Separate Run filter
- **WHEN** the user supplies `--run-id alpha-260901-100000`
- **THEN** only events explicitly associated with that Run are returned

#### Scenario: Legacy misnamed filter rejected
- **WHEN** the user supplies `--experiment-id alpha-260901-100000`
- **THEN** the command fails with BAD_REQUEST and points to --run-id rather than silently ignoring the filter

### Requirement: Automatic capture submission computes bounded fingerprints

The CLI SHALL expose journal submit --files as defined by activity-capture. It SHALL compute bounded document fingerprints and SHALL NOT accept Journal prose or expose unimplemented evidence show/check/confirm/revoke commands.

#### Scenario: Lint is a pure read
- **WHEN** document lint runs
- **THEN** it creates neither an activity receipt nor evidence-confirmation metadata

### Requirement: Removed authoring commands fail without side effects

The CLI SHALL remove Journal append/digest-mark registrations and their authoring helpers. Invocations SHALL fail clearly rather than run a compatibility writer. Doctor and separate document validate commands SHALL remain retired; structural lint is the supported check workflow.

#### Scenario: Old append invocation
- **WHEN** an old skill invokes journal append
- **THEN** the command fails without changing legacy history or creating a narrative receipt

## MODIFIED Requirements

### Requirement: Default JSON output, `--format human` for human

All read subcommands (`list`, `show`, `search`, `hypo list`, `hypo show`, **`scan`**, **`hypotheses read`**, **`journal read`**) SHALL default to machine-readable JSON output on stdout to support agent consumption. A `--format human` flag SHALL switch to a tabular/colored human-readable rendering.

Write subcommands (`experiment status set`, `experiment readme write`, `run record`, `journal submit`) SHALL emit JSON status objects on stdout (`{"ok":true,...}` on success, structured error JSON on failure). They SHALL NOT have a `--format human` mode in v1; their output is intended for skill consumption.

#### Scenario: JSON list output
- **WHEN** the user runs `memon list`
- **THEN** stdout is valid JSON: `{"experiments": [...]}` with all parsed front-matter fields

#### Scenario: Human list output
- **WHEN** the user runs `memon list --format human`
- **THEN** stdout is a table with columns `id | status emoji | name | created_at | hypotheses`

#### Scenario: Write command JSON output
- **WHEN** any write subcommand succeeds
- **THEN** stdout is `{"ok":true, ...command-specific fields...}`; the command SHALL NOT print human-readable lines on stdout

### Requirement: `memon experiment status set` writes README + appends [STATUS] atomically

`memon experiment status set <id> --project-root <path> --to <STATUS> --expected-mtime <ms>` SHALL operate in two modes depending on the form of `<id>`:

**Run-id form (legacy / v2-compatible)**: when `<id>` matches `RUN_DIR_REGEX` (`^.+-\d{6}-\d{6}$`), the command SHALL be a deprecation alias for `memon run status set <id>` and SHALL emit a one-line `[deprecation]` banner to stderr (suppressible via `MEMON_QUIET_DEPRECATIONS=1`). The accepted `<STATUS>` values in this mode are the run-side enum (`PENDING` / `RUNNING` / `FINISHED` / `INTERRUPTED` / `FAILED` / `UNKNOWN`).

**Exp-id form (v3+)**: when `<id>` matches `EXPERIMENT_FILENAME_REGEX` (`^E\d{4}-[a-z0-9-]+$`), the command operates on `docs/experiments/<id>.md` per the new requirement under `experiment-edit`'s "memon experiment status set writes status + appends [EXP_STATUS] atomically." The accepted `<STATUS>` values in this mode are the `ExperimentStatus` enum (`OPEN` / `RESOLVED` / `ABANDONED`).

In both modes, the command SHALL apply the soft warning per `archive-frontmatter` when the target is `archived: true`. In run-id mode, the command SHALL apply the hard `archive-on-RUNNING` rule per `archive-frontmatter` when the new state would result in `archived: true, status: RUNNING`.

#### Scenario: Run-id form is a deprecation alias
- **WHEN** the user runs `memon experiment status set foo-260513-100000 --project-root <p> --to FINISHED --expected-mtime <m>`
- **THEN** stderr contains `[deprecation]` banner pointing to `memon run status set`
- **AND** the command dispatches to `memon run status set` and exits 0

#### Scenario: Exp-id form sets ExperimentStatus
- **WHEN** the user runs `memon experiment status set E0001-foo --project-root <p> --to RESOLVED --expected-mtime <m>`
- **THEN** the doc's frontmatter has `status: RESOLVED`
- **AND** the automatic invocation includes a `[EXP_STATUS] OPEN → RESOLVED` line
- **AND** stdout `{"ok":true,"mtime":<n>,"prevStatus":"OPEN","nextStatus":"RESOLVED"}`

#### Scenario: Exp-id form rejects run-side enum value
- **WHEN** the user runs `memon experiment status set E0001-foo --to FINISHED`
- **THEN** the command exits 2 with `{"error":{"code":"BAD_REQUEST","message":"unknown ExperimentStatus value 'FINISHED'; expected OPEN|RESOLVED|ABANDONED"}}`

### Requirement: `memon experiment warning` subcommands

The CLI SHALL expose `memon experiment warning` operating on the
**experiment doc**'s `## Warnings` section (the warnings table is now
exp-side per `experiment-readme`). The command set is the same as the
ADDED requirement above: `add` / `resolve` / `reopen` / `delete` /
`list`. The `add` subcommand accepts an optional `--run <run-dir>` flag
to populate the `Run` column.

`add` SHALL generate `Created` from the system clock with timezone
offset preserved, generate a `rowId` of the form
`w_<isoCreatedColonsToHyphens>_<4hex>`, and reject `--category` values
outside `{methodology, result, config, data, repro, compare, infra,
other}` with exit 2 `BAD_REQUEST`.

`resolve` SHALL set `Status=RESOLVED`, `Resolved=<now-ISO with offset>`,
and `Note=<--note>`. `--note` SHALL be required for `resolve`.

`reopen` SHALL set `Status=OPEN`, clear `Resolved` and `Note`, and
preserve `Created` and `Run`.

`delete` SHALL remove the row; the invocation detail SHALL include the
deleted row's complete content for reversibility.

#### Scenario: add with run attribution
- **WHEN** the user runs `memon experiment warning add E0001-foo --run
  bar-260501-100000 --category result --message "..."`
- **THEN** stdout is `{"ok":true,"rowId":"...","mtime":...}`, the `##
  Warnings` table on the exp doc has the new row with Run cell
  `bar-260501-100000`, and the automatic invocation includes a `[WARNING]` event with
  `run: "bar-260501-100000"`

#### Scenario: add without --run is exp-scoped
- **WHEN** the same command runs without `--run`
- **THEN** the new row's Run cell is `—`, the invocation detail has
  `run: null`

### Requirement: `memon experiment archive` toggles the `archived` frontmatter field

`memon experiment archive <id> --project-root <p>` SHALL set `archived: true` on the target's frontmatter (an exp doc when `<id>` matches `EXPERIMENT_FILENAME_REGEX`, a run README when `<id>` matches `RUN_DIR_REGEX` — the run-id form is a deprecation alias for `memon run archive`). `memon experiment unarchive <id> --project-root <p>` SHALL set `archived: false`. Both commands SHALL record a single `[ARCHIVE]` detail in the automatic invocation per `archive-frontmatter`'s "Archive subcommands write frontmatter atomically with mtime-lock + JOURNAL [ARCHIVE] event." Both SHALL bump the README / doc `updated_at` (the v3 wording "Neither command SHALL modify README.md or its mtime" no longer applies — the archive write IS a frontmatter mutation in v4).

The hard `archive-on-RUNNING` rule applies to the run-id form (or to a run-targeting `archive` command). The soft warning applies when archiving an already-archived target (no-op success with the warning suppressed per `archive-frontmatter`'s unarchive-doesn't-warn rule on the unarchive side).

#### Scenario: Archive a run via deprecation alias writes frontmatter
- **WHEN** the user runs `memon experiment archive foo-260513-100000 --project-root <p>` (run-id form)
- **THEN** stderr contains `[deprecation]` banner pointing to `memon run archive`
- **AND** the run's README has `archived: true` in frontmatter
- **AND** the automatic invocation includes a new `[ARCHIVE] \`foo-260513-100000\` op=archive` line
- **AND** README `updated_at` is bumped
- **AND** there is NO `<runDir>/.archived` sidecar created (the legacy mechanism is gone)

#### Scenario: Archive an exp doc writes frontmatter
- **WHEN** the user runs `memon experiment archive E0001-zero-snr-fix --project-root <p>` (exp-id form)
- **THEN** the doc's frontmatter has `archived: true`
- **AND** the automatic invocation includes a new `[ARCHIVE] \`E0001-zero-snr-fix\` op=archive` line

#### Scenario: Archive a RUNNING run is refused
- **GIVEN** a run with `status: RUNNING`
- **WHEN** the user runs `memon experiment archive <run-id>` or `memon run archive <run-id>`
- **THEN** the command exits 2 with `{"error":{"code":"BAD_REQUEST","message":"cannot archive a RUNNING run; set status to INTERRUPTED, FINISHED, or FAILED first"}}`

### Requirement: `memon experiment` subcommand family

The CLI SHALL expose `memon experiment` as a parent command with the following subcommands. All write subcommands SHALL emit JSON status objects on stdout (`{"ok":true, ...}`) on success and structured error JSON on failure; all read subcommands SHALL default to JSON output and support `--format human` for tabular output.

```
memon experiment ls               [--project-root <p>]
memon experiment show             <id-or-slug> [--project-root <p>]
memon experiment create           <slug> [--title <t>] [--hypotheses <H,H,...>]
                                  [--from-run <run-dir>] [--project-root <p>]
memon experiment rename           <id-or-slug> <new-slug> [--project-root <p>]
memon experiment link             <id> <run-dir-or-id> [--project-root <p>]
memon experiment unlink           <id> <run-dir-or-id> [--project-root <p>]
memon experiment delete           <id> [--force] [--project-root <p>]
memon experiment results table    <id-or-slug> [--variant <ids>] [--status <statuses>]
                                  [--column <keys>] [--group <group>] [--output <fmt>]
memon experiment warning add      <id> [--run <run-dir>] --category <cat>
                                  --message <text> [--expected-mtime <ms>]
                                  [--expected-hash <sha1>]
memon experiment warning resolve  <id> <rowId> --note <text>
                                  [--expected-mtime <ms>] [--expected-hash <sha1>]
memon experiment warning reopen   <id> <rowId> [--note <text>]
                                  [--expected-mtime <ms>] [--expected-hash <sha1>]
memon experiment warning delete   <id> <rowId>
                                  [--expected-mtime <ms>] [--expected-hash <sha1>]
memon experiment warning list     <id> [--status open|resolved|all]
```

The `id` argument SHALL accept either the canonical `E<NNNN>-<slug>` form or the slug alone (when the slug uniquely identifies an experiment). The `--run <run-dir>` option on `warning add` populates the `Run` column of the new row; absence means the warning is exp-scoped (rendered as `—`).

The `experiment create` and `experiment rename` commands' behaviors are detailed in the `experiment-edit` capability; the `experiment link` / `unlink` / `delete` commands' behaviors are detailed there as well.

The `experiment warning *` write commands SHALL:
- Use the section-bound writer for `## Warnings` defined in `experiment-readme`.
- Record a `[WARNING]` detail in the automatic invocation per write, including the `run` attribution.

#### Scenario: `experiment ls` returns JSON list
- **WHEN** the user runs `memon experiment ls --project-root <p>`
- **THEN** stdout is JSON `{"experiments": [...]}` with one entry per exp doc, including effective times computed from member runs

#### Scenario: `experiment warning add` requires a run for run-scoped
- **WHEN** the user runs `memon experiment warning add E0001 --run bar-260501-100000 --category result --message "..."`
- **THEN** the new row's `Run` cell is `bar-260501-100000`, the `[WARNING]` event has `run: "bar-260501-100000"`, and stdout is `{"ok":true,"rowId":"...","mtime":...}`

#### Scenario: `experiment warning add` without --run is exp-scoped
- **WHEN** the same command runs without `--run`
- **THEN** the new row's `Run` cell is `—`, the `[WARNING]` event has `run: null`

#### Scenario: `experiment rename` is listed in the subcommand family
- **WHEN** the user runs `memon experiment --help`
- **THEN** the printed subcommand list includes `rename <id-or-slug> <new-slug>` between `create` and `link`
- **AND** the detailed behavior of the command is detailed in the `experiment-edit` capability

### Requirement: memon experiment warning subcommands resolve exp-id via v5-aware discovery

The CLI's `memon experiment warning {add, list, resolve, reopen, delete}` subcommands SHALL resolve their first positional argument when it matches `^E\d{4}-[a-z0-9][a-z0-9-]*$` (the canonical exp-id form, `EXP_ID_RE`) by calling the core library's `discoverExperiments(projectRoot, projectName)` and selecting the returned record whose `.id` equals the supplied id, then using that record's `.path` field as the read/write target (already the absolute path to the exp doc README under the v5 folder layout, with the legacy v4 file form supported as a transitional `LEGACY_LAYOUT` fallback). The CLI SHALL NOT construct the README path manually as `join(projectRoot, 'docs', 'experiments', '${id}.md')` — that hard-coded form was correct under v4 but silently 404s on v5 layouts. When `discoverExperiments` returns no record matching the supplied id, the CLI SHALL exit with `NOT_FOUND` and stderr message `experiment "<id>" not found in <projectRoot>`. The run-dir-form branch (first argument does not match `EXP_ID_RE`, treated as a v2 run-dir base name, resolved via `scanProjectRoot`) SHALL remain unchanged.

#### Scenario: warning add resolves exp-id to v5 folder README
- **GIVEN** a project root with `docs/experiments/E0001-foo/README.md` containing the canonical `## Warnings` table header
- **WHEN** the user runs `memon experiment warning add E0001-foo --run bar-260501-100000 --category result --message "loss diverges" --project-root <root>`
- **THEN** the CLI writes the new row to `docs/experiments/E0001-foo/README.md` (the v5 location)
- **AND** the invocation `[WARNING]` detail carries `` `E0001-foo` op=add ... run=bar-260501-100000 ... ``
- **AND** the response is `{"ok":true,"rowId":"w_...","mtime":...}`

#### Scenario: warning add resolves exp-id to legacy v4 file during migration
- **GIVEN** a project root mid-migration with `docs/experiments/E0001-foo.md` still in legacy file form (no folder yet — the migration has not run for this id)
- **WHEN** the user runs `memon experiment warning add E0001-foo --category result --message "..." --project-root <root>`
- **THEN** the CLI writes the new row to `docs/experiments/E0001-foo.md` (the legacy file location, since `discoverExperiments` reports it under the `LEGACY_LAYOUT` fallback)
- **AND** the operation succeeds (no NOT_FOUND)

#### Scenario: warning add against non-existent exp-id returns NOT_FOUND
- **GIVEN** a project root with no `docs/experiments/E0099-*` folder or file
- **WHEN** the user runs `memon experiment warning add E0099-missing --category result --message "..."`
- **THEN** the CLI exits with `NOT_FOUND` and stderr names the missing id
- **AND** no file is written
- **AND** no legacy Journal file is modified

#### Scenario: warning list reads via v5-aware discovery
- **GIVEN** a project root with `docs/experiments/E0001-foo/README.md` containing one warning row
- **WHEN** the user runs `memon experiment warning list E0001-foo`
- **THEN** stdout is `{"ok":true,"warnings":[{...one row...}],"mtime":...,"hash":...}`

## REMOVED Requirements

### Requirement: `memon scan <project-root>` returns the full project snapshot
**Reason**: The redesigned workflow intentionally replaces the former contract, including its obsolete authoring/default-context scenarios.
**Migration**: Use "Project scan excludes diagnostic history"; preserve historical user content and cut over every supported caller without a silent compatibility writer.

### Requirement: `memon journal read` exposes paged query
**Reason**: The redesigned workflow intentionally replaces the former contract, including its obsolete authoring/default-context scenarios.
**Migration**: Use "Journal diagnostic query uses typed filters and stable paging"; preserve historical user content and cut over every supported caller without a silent compatibility writer.

### Requirement: `memon journal append` is the only path for non-STATUS events
**Reason**: Automatic mutation/finalization recording replaces manual event prose.
**Migration**: Remove the command and update every bundled skill and UI caller; preserve historical lines.

### Requirement: `memon journal digest-mark` is the only path that updates `last_digest_at`
**Reason**: The digest cursor and its authoring workflow are retired.
**Migration**: Remove the command, helper and all normal callers; leave historical metadata unchanged.
