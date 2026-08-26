## ADDED Requirements

### Requirement: `memon serve` accepts only instance configurations

`memon serve` SHALL treat `config.example.yml` as a protected documentation
template, not a valid active server configuration. Default resolution SHALL
continue to inspect only `<cwd>/config.yml` and `<repo-root>/config.yml`; the
presence of `config.example.yml` SHALL NOT satisfy the requirement for a
configuration file.

If `--config <path>` resolves to a path whose final component is exactly
`config.example.yml`, the command SHALL reject it before spawning Next.js and
print a structured, actionable error directing the operator to copy the
template to `config.yml` or another instance path. Explicit non-example paths
remain valid and are exported through `MEMON_CONFIG_PATH` under the existing
serve contract.

#### Scenario: Only the example exists during default serve

- **GIVEN** `config.example.yml` exists in the repository but no `config.yml`
  exists in cwd or the repository root
- **WHEN** the user runs `memon serve`
- **THEN** the command exits with a structured error explaining how to create
  an instance configuration
- **AND** it does not spawn Next.js
- **AND** it does not modify or copy `config.example.yml`

#### Scenario: Explicit example path is rejected

- **WHEN** the user runs `memon serve --config ./config.example.yml`
- **THEN** the command exits non-zero before spawning Next.js
- **AND** stderr identifies `config.example.yml` as a template and recommends
  an instance path
- **AND** no runtime environment is allowed to persist into that file

#### Scenario: Explicit custom instance path remains supported

- **GIVEN** `/etc/memon/cluster.yml` is a valid configuration
- **WHEN** the user runs `memon serve --config /etc/memon/cluster.yml`
- **THEN** the command spawns the web server with
  `MEMON_CONFIG_PATH=/etc/memon/cluster.yml`
- **AND** first-run authentication persistence may update that instance under
  the `auth-system` contract
