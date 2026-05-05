## ADDED Requirements

### Requirement: `memon experiment warning` subcommands

The CLI SHALL expose a `memon experiment warning` command group with the following subcommands:

```
memon experiment warning add <id>     --project-root <p> --category <cat> --message <text>
                                      [--expected-mtime <ms>] [--expected-hash <sha1>]
memon experiment warning list <id>    --project-root <p> [--status open|resolved|all]
memon experiment warning resolve <id> <rowId> --project-root <p> --note <text>
                                      [--expected-mtime <ms>] [--expected-hash <sha1>]
memon experiment warning reopen <id>  <rowId> --project-root <p> [--note <text>]
                                      [--expected-mtime <ms>] [--expected-hash <sha1>]
memon experiment warning delete <id>  <rowId> --project-root <p>
                                      [--expected-mtime <ms>] [--expected-hash <sha1>]
```

All write subcommands (`add`, `resolve`, `reopen`, `delete`) SHALL use the section-bound writer for `## Warnings` defined in the `experiment-readme` capability and SHALL append a `[WARNING]` event to `JOURNAL.md` describing the operation. Read subcommands (`list`) SHALL NOT modify any file. Output SHALL follow the existing `--format json|human` convention with JSON as default.

`add` SHALL generate `Created` from the system clock with timezone offset preserved (never UTC-normalised), generate a `rowId` of the form `w_<isoCreatedColonsToHyphens>_<4hex>`, and reject `--category` values outside the closed enum `{methodology, result, config, data, repro, compare, infra, other}` with exit 2 `BAD_REQUEST`.

`resolve` SHALL set `Status=RESOLVED`, `Resolved=<now-ISO with offset>`, and `Note=<--note>`. The `--note` flag SHALL be required for `resolve`. `reopen` SHALL set `Status=OPEN`, clear `Resolved` and `Note`, and preserve `Created`.

`delete` SHALL remove the row from the table; the JOURNAL event SHALL include the deleted row's complete content for reversibility.

#### Scenario: add appends a row and emits structured stdout
- **WHEN** the user runs `memon experiment warning add foo-260501 --project-root . --category result --message "loss spike at step 1500"`
- **THEN** stdout is `{"ok":true,"rowId":"w_2026-05-05T14-32-00+0800_a3f1","mtime":<new>}`, the `## Warnings` section in the README contains the new row, and JOURNAL.md has a new `[WARNING]` event with `op=add`

#### Scenario: list filters by status
- **GIVEN** a README with two OPEN rows and one RESOLVED row
- **WHEN** the user runs `memon experiment warning list foo-260501 --project-root . --status open`
- **THEN** stdout is a JSON array of length 2 containing only the OPEN rows, each carrying its `rowId`, `category`, `message`, `created`, `resolved`, and `note`

#### Scenario: resolve requires --note
- **WHEN** the user runs `memon experiment warning resolve foo-260501 w_xxx --project-root .` (no `--note`)
- **THEN** the command exits 2 with `BAD_REQUEST` and a stderr message naming the missing flag

#### Scenario: Unknown category rejected
- **WHEN** the user runs `memon experiment warning add foo-260501 --project-root . --category aesthetic --message "..."`
- **THEN** the command exits 2 `BAD_REQUEST` with a stderr message listing the accepted enum values; the README is not modified

#### Scenario: rowId not found
- **WHEN** the user runs `memon experiment warning resolve foo-260501 w_does_not_exist --project-root . --note "..."`
- **THEN** the command exits 4 `NOT_FOUND` and the README is not modified

#### Scenario: CONFLICT on stale expected-mtime
- **WHEN** any write subcommand is invoked with `--expected-mtime` older than the current on-disk mtime AND the warnings section was edited in between
- **THEN** the command exits 9 `CONFLICT` and the stderr JSON includes the current mtime + content so the caller can retry

#### Scenario: delete preserves audit trail in JOURNAL
- **GIVEN** a row `w_xxx` with category `result` and a non-trivial message
- **WHEN** the user runs `memon experiment warning delete foo-260501 w_xxx --project-root .`
- **THEN** the row is removed from the table AND JOURNAL.md has a new `[WARNING]` event with `op=delete` whose body contains the deleted row's full content

### Requirement: `WARN_UNRESOLVED` doctor code

`memon doctor`'s rule set SHALL include a code `WARN_UNRESOLVED` (severity `info`) that triggers when an experiment has at least one warning row with `Status=OPEN`. The issue payload SHALL include a `count` field with the number of open warnings on that experiment so the consumer can order or filter by noise.

The code SHALL NOT cause exit code 1 (`info` severity does not bump the exit code per the existing severity rules). The `--severity warn` filter SHALL exclude `WARN_UNRESOLVED` from output but it SHALL still appear in `summary.byCode`.

#### Scenario: Open warning surfaces WARN_UNRESOLVED
- **GIVEN** an experiment whose `## Warnings` table contains at least one row with `Status=OPEN`
- **WHEN** the user runs `memon doctor --project-root .`
- **THEN** the issues array contains a `WARN_UNRESOLVED` entry for that experiment with `severity: "info"` and a `count` reflecting the number of open warnings

#### Scenario: All RESOLVED suppresses WARN_UNRESOLVED
- **GIVEN** an experiment whose `## Warnings` table contains only RESOLVED rows
- **WHEN** `memon doctor` runs
- **THEN** no `WARN_UNRESOLVED` issue is emitted for that experiment

#### Scenario: WARN_UNRESOLVED does not bump exit code
- **GIVEN** a project where every doctor finding is `WARN_UNRESOLVED`
- **WHEN** `memon doctor` runs
- **THEN** the command exits 0 (info-only severities do not bump exit code per existing rules)
