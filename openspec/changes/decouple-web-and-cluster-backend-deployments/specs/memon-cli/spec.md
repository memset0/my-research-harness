## ADDED Requirements

### Requirement: CLI serves explicit central and Backend roles
The CLI SHALL provide canonical entry paths that execute the actual custom central server and actual Backend server, including HTTP and WebSocket handling. It SHALL NOT implement a role by invoking a framework server that bypasses required gateway/proxy logic. Existing `memon serve` SHALL continue to serve standalone instances.

#### Scenario: Central serve activates gateway upgrades
- **WHEN** the CLI starts a central instance
- **THEN** its configured bind address/port, Backend routing, SSE, and terminal WebSocket upgrade handlers are active

### Requirement: CLI exposes the complete Backend lifecycle family
The CLI SHALL expose `memon backend serve`, `daemon start|stop|restart|status`, `install --revision`, `update --revision`, `rollback`, and explicit token generation with selected-config support and stable structured output/exit codes. Status and errors SHALL redact all tokens and private-key material.

#### Scenario: Update result is Agent-readable
- **WHEN** a pinned Backend update succeeds or rolls back
- **THEN** JSON output identifies requested/installed/running revision, readiness, daemon outcome, and rollback outcome without secrets

### Requirement: Ordinary cluster-local CLI commands remain local
Existing Project scan/read/write/doctor/skill commands invoked on a cluster SHALL continue to operate against that local Project configuration without requiring central availability or Backend service credentials.

#### Scenario: Central outage does not block local CLI read
- **WHEN** central is unavailable and a user runs an ordinary local read command on a cluster Host
- **THEN** the command reads local Project state according to its existing contract

### Requirement: Legacy Hub/Node config is rejected
The CLI/config loader SHALL reject abandoned `hub:` or `node:` blocks with a clear migration message and SHALL NOT start the node-initiated WebSocket implementation.

#### Scenario: Old node config cannot silently start
- **WHEN** an instance config contains the abandoned `node:` block
- **THEN** startup fails with guidance to use central/Backend configuration
