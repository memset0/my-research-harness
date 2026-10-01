## MODIFIED Requirements

### Requirement: `memon wiki` command group and addressing

`memon wiki <subcommand>` SHALL exist with exactly the subcommands `ls`, `show`, `create`, `move`, `set`, `review`, `commit`, `lint`, `backlinks`, `migrate-report`, `kinds`, `deprecate`, `undeprecate`, `delete`. The group SHALL NOT register `stale`, `data` or `components` subcommands: source-staleness is a Web projection (see the `ls` and `backlinks` requirements), and component execution is `memon components run`. Every subcommand SHALL accept `--project-root <p>` (defaulting to `cwd`) and `--format json|human` (default `json`); `ls` and `show` SHALL additionally accept `--format markdown`. Where a `<page>` argument is taken it SHALL accept a slug (primary) or a canonical `W<NNNN>` id; an unpadded id (`W7`) SHALL exit 2 `BAD_REQUEST`; an unknown page SHALL exit 4 `NOT_FOUND`. Error output SHALL be a single JSON object on stderr of the form `{"error":{"code":…,"message":…}}`.

#### Scenario: Slug addressing
- **GIVEN** page `W0004` with slug `vsa-debt`
- **WHEN** the user runs `memon wiki show vsa-debt --project-root .`
- **THEN** the output is identical to `memon wiki show W0004 --project-root .`

#### Scenario: Unknown page
- **WHEN** the user runs `memon wiki show nope --project-root .`
- **THEN** the command exits 4 with `{"error":{"code":"NOT_FOUND",…}}`

#### Scenario: Inspect installed kinds without a project
- **WHEN** the user runs `memon wiki kinds ls` or `memon wiki kinds show <kind>` with `--format human|json`
- **THEN** the command returns the shipped registry definitions without project discovery, central access, git or journal writes
- **AND** an unknown kind exits 2 with BAD_REQUEST

#### Scenario: Unregistered subcommands are rejected
- **WHEN** the user runs `memon wiki stale`, `memon wiki data` or `memon wiki components`
- **THEN** the command fails as an unknown command with a non-zero exit and reads or writes no Wiki file
