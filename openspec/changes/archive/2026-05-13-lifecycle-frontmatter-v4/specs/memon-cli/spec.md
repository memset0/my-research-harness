## MODIFIED Requirements

### Requirement: `memon doctor` reports incomplete-state issues without writing

`memon doctor --project-root <p> [--include-archived] [--severity <min>]` SHALL scan the project root, run a fixed set of consistency rules, and emit an issue list. The command SHALL NOT modify any file on disk. Exit code SHALL reflect the highest severity present: `0` when no issues or only `info`/`warn`; `1` when at least one `error` issue is reported. The `--severity` flag (default `info`) filters issues at or above that level.

The rule set v4 (additions to v3 marked):

| `code` | `severity` | trigger |
|---|---|---|
| `MISSING_RESULT` | `warn` | `status === 'FINISHED'` and `sections.result` is missing or only whitespace |
| `MISSING_CONCLUSION` | `warn` | `status === 'FINISHED'` and `sections.conclusion` missing |
| `FAILED_NO_NOTE` | `info` | `status === 'FAILED'` and `sections.result` is empty |
| `INTERRUPTED_NO_NOTE` | `info` | (v4-added) `status === 'INTERRUPTED'` and `sections.result` is empty (whitespace-only counts as empty) |
| `RESOLVED_NO_CONCLUSION` | `info` | (v4-added) exp doc with `status === 'RESOLVED'` and `sections.conclusion` is empty |
| `STALE_RUNNING` | `info` | `status === 'RUNNING'` and `isStaleRunning` returns true |
| `PARSE_ERROR` | `error` | `parseErrors.length > 0` |
| `PARSE_WARNING` | `warn` | `parseWarnings.length > 0` |
| `ORPHAN_HYPOTHESIS_REF` | `warn` | front matter `hypotheses[]` contains an id NOT present in HYPOTHESES.md `entries[].id` |
| `LEGACY_ARCHIVE_SIDECAR` | `info` | (v4-added; emitted via parse-warning bubbling) run README lacks `archived` frontmatter and a `<runDir>/.archived` sidecar exists; instructs the user to re-run migration or set the field manually |

The doctor SHALL NOT add lints that depend on the soft warning emitted at write time by `archive-frontmatter` — the soft warning is a write-time signal, not a static lint.

The doctor SHALL NOT add a lint for `ABANDONED` exp without `## Caveats` in v4; tentatively unnecessary, can be added later if user feedback supports it.

#### Scenario: INTERRUPTED with empty Result triggers info lint
- **GIVEN** a run with `status: INTERRUPTED` and `## Result` section is missing or only whitespace
- **WHEN** the user runs `memon doctor --project-root .`
- **THEN** the issues array contains a `INTERRUPTED_NO_NOTE` entry with `severity: 'info'`
- **AND** the exit code is 0 (info severity does not bump exit code per existing rules)

#### Scenario: RESOLVED exp without Conclusion triggers info lint
- **GIVEN** an exp doc with `status: RESOLVED` and `## Conclusion` is empty
- **WHEN** the user runs `memon doctor --project-root .`
- **THEN** the issues array contains a `RESOLVED_NO_CONCLUSION` entry with `severity: 'info'`

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
- **AND** JOURNAL has a `[EXP_STATUS] OPEN → RESOLVED` line
- **AND** stdout `{"ok":true,"mtime":<n>,"prevStatus":"OPEN","nextStatus":"RESOLVED"}`

#### Scenario: Exp-id form rejects run-side enum value
- **WHEN** the user runs `memon experiment status set E0001-foo --to FINISHED`
- **THEN** the command exits 2 with `{"error":{"code":"BAD_REQUEST","message":"unknown ExperimentStatus value 'FINISHED'; expected OPEN|RESOLVED|ABANDONED"}}`

### Requirement: `memon experiment archive` toggles the `archived` frontmatter field

`memon experiment archive <id> --project-root <p>` SHALL set `archived: true` on the target's frontmatter (an exp doc when `<id>` matches `EXPERIMENT_FILENAME_REGEX`, a run README when `<id>` matches `RUN_DIR_REGEX` — the run-id form is a deprecation alias for `memon run archive`). `memon experiment unarchive <id> --project-root <p>` SHALL set `archived: false`. Both commands SHALL append a single `[ARCHIVE]` event to JOURNAL.md per `archive-frontmatter`'s "Archive subcommands write frontmatter atomically with mtime-lock + JOURNAL [ARCHIVE] event." Both SHALL bump the README / doc `updated_at` (the v3 wording "Neither command SHALL modify README.md or its mtime" no longer applies — the archive write IS a frontmatter mutation in v4).

The hard `archive-on-RUNNING` rule applies to the run-id form (or to a run-targeting `archive` command). The soft warning applies when archiving an already-archived target (no-op success with the warning suppressed per `archive-frontmatter`'s unarchive-doesn't-warn rule on the unarchive side).

#### Scenario: Archive a run via deprecation alias writes frontmatter
- **WHEN** the user runs `memon experiment archive foo-260513-100000 --project-root <p>` (run-id form)
- **THEN** stderr contains `[deprecation]` banner pointing to `memon run archive`
- **AND** the run's README has `archived: true` in frontmatter
- **AND** JOURNAL has a new `[ARCHIVE] \`foo-260513-100000\` op=archive` line
- **AND** README `updated_at` is bumped
- **AND** there is NO `<runDir>/.archived` sidecar created (the legacy mechanism is gone)

#### Scenario: Archive an exp doc writes frontmatter
- **WHEN** the user runs `memon experiment archive E0001-zero-snr-fix --project-root <p>` (exp-id form)
- **THEN** the doc's frontmatter has `archived: true`
- **AND** JOURNAL has a new `[ARCHIVE] \`E0001-zero-snr-fix\` op=archive` line

#### Scenario: Archive a RUNNING run is refused
- **GIVEN** a run with `status: RUNNING`
- **WHEN** the user runs `memon experiment archive <run-id>` or `memon run archive <run-id>`
- **THEN** the command exits 2 with `{"error":{"code":"BAD_REQUEST","message":"cannot archive a RUNNING run; set status to INTERRUPTED, FINISHED, or FAILED first"}}`

### Requirement: Read commands honor archive filter via `--include-archived`

`list` / `scan` / `show` / `search` / `journal read` / `hypo list` / `hypotheses read` / `doctor` SHALL skip experiments AND runs whose `archived: true` (per the frontmatter field, NOT the legacy sidecar) by default. A `--include-archived` flag SHALL include them. An `--archived-only` flag SHALL include only items with `archived: true`.

When the legacy `<runDir>/.archived` sidecar fallback path applies (per `archive-frontmatter`'s "Sidecar fallback during the migration window"), the read commands SHALL honor the fallback — i.e., a run whose README lacks the field but has the sidecar IS treated as archived for filter purposes.

#### Scenario: list excludes archived by default (frontmatter-driven)
- **GIVEN** a run whose README has `archived: true` in frontmatter
- **WHEN** the user runs `memon list --project-root <p>`
- **THEN** the run is NOT in the output

#### Scenario: list --include-archived includes both frontmatter and sidecar-fallback archived items
- **GIVEN** a project with one run archived via frontmatter (`archived: true`) and one archived via sidecar fallback (README lacks the field, sidecar exists)
- **WHEN** the user runs `memon list --project-root <p> --include-archived`
- **THEN** both runs are present in the output, each with `archived: true` on the record
- **AND** the sidecar-fallback run additionally has a parse warning `code: 'LEGACY_ARCHIVE_SIDECAR'`

#### Scenario: --archived-only filters to archived items
- **WHEN** the user runs `memon list --project-root <p> --archived-only`
- **THEN** only items with `archived: true` (per frontmatter or legacy sidecar) are returned
