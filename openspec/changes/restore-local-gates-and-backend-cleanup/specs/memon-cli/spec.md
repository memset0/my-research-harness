## MODIFIED Requirements

### Requirement: Stable exit-code dictionary

The CLI SHALL use this exit code table for all subcommands. Skills depend on these for branch logic.

| code | semantic |
|---|---|
| 0 | success |
| 1 | generic / unclassified failure |
| 2 | usage / flag error (including Commander option and argument parse failures) |
| 4 | NOT_FOUND (resource doesn't exist) |
| 9 | CONFLICT (mtime / hash lock failure — skill should refresh and retry) |
| 11 | MEMON_TOO_OLD (project's `fs_convention_version` exceeds `FS_CONVENTION_VERSION`; user must upgrade memon) |
| 13 | FORBIDDEN (path safety / permission) |

Every classified failure (BAD_REQUEST, NOT_FOUND, CONFLICT, FORBIDDEN, MEMON_TOO_OLD) SHALL be written to stderr as the structured envelope `{"error":{"code","message","details?"}}` in both human and JSON output modes, and SHALL be recorded in the invocation receipt with the same code, so a lock conflict is recorded as a conflict rather than as an interrupted invocation. The exit code SHALL be derived from the error code by this table.

#### Scenario: Skill retries on exit 9
- **WHEN** any write command exits with code 9
- **THEN** the stderr JSON has `error.code === "CONFLICT"` and stdout/stderr include enough state for the caller to retry without losing intent (current mtime + current content for README writes; current frontmatter for digest-mark)

#### Scenario: Status and README lock conflicts use the structured envelope
- **WHEN** `memon run status set`, `memon run readme write`, `memon experiment status set` or a `memon experiment warning` write finds the on-disk mtime or hash differs from the expected value
- **THEN** the command exits 9
- **AND** stderr is one `{"error":{"code":"CONFLICT",…,"details":{…}}}` line whose `details` carries the current mtime (and the current or actual hash when a hash was compared)
- **AND** the invocation receipt records the outcome as a conflict

#### Scenario: Missing hypothesis or run exits 4
- **WHEN** `memon hypo show <id>` names a hypothesis that does not exist, or `memon show <id>` names a run that does not exist
- **THEN** the command exits 4
- **AND** stderr carries `{"error":{"code":"NOT_FOUND",…}}` and stdout is empty, regardless of `--format`

#### Scenario: Parser failure exits 2
- **WHEN** Commander rejects the command line (unknown option, missing required argument, invalid choice)
- **THEN** the command exits 2
- **AND** the invocation receipt, when one is written, records `BAD_REQUEST`

#### Scenario: Forward-incompatible project root exits 11
- **GIVEN** `<root>/.memon/version.json` has `fs_convention_version: 5` and the running memon has `FS_CONVENTION_VERSION === 3`
- **WHEN** any command that preflights FS version runs against `<root>` (`memon install-skills`, `memon fs-version check`, or any preflight-checking skill invocation)
- **THEN** the command exits with code 11
- **AND** the stderr JSON has `error.code === "MEMON_TOO_OLD"`
- **AND** the message names both the project's version and the tool's version
