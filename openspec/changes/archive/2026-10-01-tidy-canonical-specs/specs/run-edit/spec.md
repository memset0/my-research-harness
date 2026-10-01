## ADDED Requirements

### Requirement: Runs store no warnings; run warning add writes through to the parent Experiment

Runs SHALL NOT store warnings. Warnings about a Run SHALL live in the parent Experiment's `## Warnings` table, attributed through its `Run` column. memon writers (CLI, Web, backend) SHALL NOT create, append to, or mutate a `## Warnings` section in a Run README. A legacy `## Warnings` section that still exists in a Run README SHALL be preserved verbatim and SHALL NOT be merged into, or alter, the parent Experiment's warnings table.

`memon run warning add <run-id-or-dir> --category C --message M` SHALL remain a compatibility entry that writes through to the parent Experiment:
- it resolves the Run, then resolves its parent Experiment from the Experiment declarations (per FS v7 membership), and performs the same write as `memon experiment warning add <exp> --run <run-dir> --category C --message M`, including the optional `--expected-mtime` / `--expected-hash` lock on the Experiment README;
- it prints exactly one non-suppressible `[deprecated]` notice on stderr directing Agents to maintain Warnings through `memon-write-experiment-doc`, the same notice every `memon experiment warning …` invocation prints;
- an orphan Run (no declaring Experiment) SHALL fail with `BAD_STATE` (exit 1) naming `memon experiment link` as the unblock command and SHALL write nothing;
- an unknown Run SHALL fail with `NOT_FOUND` (exit 4).

#### Scenario: Run warning add writes through to the parent Experiment
- **GIVEN** Run `bar-260501-100000` declared by Experiment `E0002-bar`
- **WHEN** the user runs `memon run warning add bar-260501-100000 --category data --message "shard 3 truncated"`
- **THEN** a new row with Run cell `bar-260501-100000` is appended to `E0002-bar`'s `## Warnings` table
- **AND** the Run README is not modified
- **AND** stderr contains exactly one `[deprecated]` notice

#### Scenario: Orphan run is refused
- **GIVEN** a Run that no Experiment declares
- **WHEN** the user runs `memon run warning add <run> --category other --message m`
- **THEN** the command exits 1 with `BAD_STATE` naming `memon experiment link`, and no file is written

#### Scenario: Legacy Run warnings section is left untouched
- **GIVEN** a v2-style Run README that still has a `## Warnings` body
- **WHEN** the Run is indexed, or its status or archived flag is changed through a memon writer
- **THEN** the `## Warnings` body is preserved verbatim
- **AND** the parent Experiment's warnings table is unaffected by the Run's old rows

## REMOVED Requirements

### Requirement: Run-side warnings do not exist in v3

**Reason**: It claimed `memon experiment warning …` is the only warning path and that the parser flags a Run `## Warnings` section with `LEGACY_SECTION_IN_RUN`; neither holds. `memon run warning add` exists as a write-through compatibility entry, and the parser does not emit that code.
**Migration**: Replaced by "Runs store no warnings; run warning add writes through to the parent Experiment", which keeps the no-Run-side-storage rule and describes the write-through entry and its `[deprecated]` notice.
