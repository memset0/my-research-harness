## MODIFIED Requirements

### Requirement: Remote installation contains no required Backend lifecycle
The remote memon installation SHALL provide CLI and managed skills without a required Backend worker, supervisor, protocol negotiation or fleet update service. An optional independently installed file-only agent SHALL NOT become a requirement of CLI or managed-skill installation and SHALL NOT share their automatic update/restart lifecycle. Removed Backend commands SHALL not remain as compatibility shims that start the retired service. The `@memon/backend` package SHALL NOT ship or export daemon control, supervision, release distribution, update preflight/activation or start-guard implementations; it contains only the in-process project services and request handler that central uses.

#### Scenario: CLI only node
- **WHEN** a user installs or updates remote memon
- **THEN** the CLI and skills can operate without starting a memon listener

#### Scenario: Backend package exports no retired lifecycle surface
- **WHEN** a consumer imports `@memon/backend`
- **THEN** no daemon controller, release store, update activation or start-guard symbol is exported
- **AND** the package's source tree contains no daemon, distribution or update module

#### Scenario: Central upgrades independently
- **WHEN** central upgrades within the agent's supported protocol major version
- **THEN** file access continues without updating or restarting the independently installed agent
