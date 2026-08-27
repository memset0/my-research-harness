# cluster-backend-api Specification

## Purpose
Defines the authenticated, versioned, streaming service contract between one central gateway and one cluster-local Backend.

## Requirements

### Requirement: Backend read-only policy is enforced locally
A Backend instance MAY select a local `read_only` access mode for private bootstrap verification. In that mode metadata SHALL advertise mutation, terminal, tmux, Herdr, and other shell/write capabilities as unavailable, and the Backend itself SHALL reject mutations, share creation/revocation, terminal control, and terminal relay before invoking a provider. Project/data GETs and share-token validation MAY remain available. Changing to normal `read_write` mode SHALL require an explicit local configuration change and process restart; `read_write` SHALL remain the default.

#### Scenario: Shadow candidate cannot become a second writer
- **WHEN** a candidate Backend starts with `access_mode: read_only`
- **THEN** central can verify metadata and Project reads, while direct authenticated write or shell requests are rejected by the Backend even if central misroutes them

### Requirement: Backend exposes one versioned static API
Each Backend SHALL expose a static `/api/backend/v1` HTTP namespace containing authenticated metadata/readiness, capabilities, Project discovery, Project reads and mutations, events, supported cluster-local product operations, and terminal relay. The runtime API SHALL NOT expose installation, Git update, daemon control, or arbitrary shell execution.

#### Scenario: Metadata identifies the expected instance
- **WHEN** central calls authenticated Backend metadata
- **THEN** the response includes Host ID, release version, Backend API major, running revision, instance epoch, readiness, and capabilities

#### Scenario: Operations control is absent
- **WHEN** a caller requests an install, Git update, daemon restart, or arbitrary command through `/api/backend/v1`
- **THEN** the Backend rejects the request because those actions exist only on the SSH-plus-local-CLI operations path

### Requirement: Backend uses independent service Bearer authentication
A Backend SHALL accept only a valid high-entropy Bearer service token from its protected instance configuration. It SHALL NOT accept central human Basic credentials, browser session cookies, viewer cookies, or another Backend's token. Token comparison SHALL be constant-time, and a Backend MAY accept exactly two tokens during bounded rotation.

#### Scenario: Browser credentials fail directly against Backend
- **WHEN** a request presents a valid central browser cookie or owner Basic credential but no valid Backend Bearer token
- **THEN** the Backend returns 401 and performs no operation

#### Scenario: Per-Host token cannot cross-authenticate
- **WHEN** the token configured for Host A is presented to Host B
- **THEN** Host B returns 401 and reveals no protected metadata

#### Scenario: Rotation overlap remains available
- **WHEN** a Backend temporarily accepts old and next tokens and central switches to next
- **THEN** authenticated readiness remains available before the old token is removed

### Requirement: Backend validates central actor authorization
Every proxied request SHALL carry a central-generated, service-authenticated actor context. The Backend SHALL reject viewer-context mutation and shell operations even when the service token is valid, and SHALL validate that the context scope contains the exact Host-qualified Project for viewer reads.

#### Scenario: Service-authenticated viewer cannot mutate
- **WHEN** central forwards a mutation with a viewer actor context
- **THEN** the Backend returns 403 and leaves cluster state unchanged

### Requirement: Backend DTOs and resource identifiers are safe and portable
Requests and responses SHALL be runtime-validated. Cross-boundary resources SHALL use Host-qualified Project identity plus relative/opaque resource identifiers; cluster absolute Project roots SHALL NOT be returned to central/browser or accepted as arbitrary request paths. Filesystem resolution SHALL reject lexical traversal, encoded separators, absolute/device paths, symlink escape, and cross-Project access.

#### Scenario: Symlink escape is rejected
- **WHEN** a relative resource identifier resolves through a symlink outside its configured Project root
- **THEN** the Backend rejects it without reading or writing the external target

#### Scenario: Project discovery hides absolute roots
- **WHEN** central lists Backend Projects
- **THEN** the response contains Project names and safe metadata but no cluster absolute root path

### Requirement: Backend transport streams with cancellation and bounds
The Backend API SHALL stream SSE, log data, report assets, and terminal traffic with backpressure rather than buffering or base64-wrapping complete responses. JSON/control bodies SHALL have explicit size limits. Downstream disconnect SHALL cancel upstream work, and a mutation SHALL NOT be automatically replayed after an ambiguous timeout.

#### Scenario: Large asset remains streamed
- **WHEN** central reads a large binary Report asset
- **THEN** bytes stream unchanged with bounded buffering and no base64 JSON expansion

#### Scenario: Client disconnect cancels Backend stream
- **WHEN** the browser disconnects during a long log stream
- **THEN** cancellation reaches the Backend and the abandoned stream stops consuming resources

### Requirement: Backend event stream identifies continuity
The Backend event endpoint SHALL provide heartbeats, an instance epoch, and a monotonic sequence within that epoch so central can detect reconnects and gaps. Events SHALL identify the local Project but SHALL NOT choose or assert the central Host routing authority.

#### Scenario: Restart changes event epoch
- **WHEN** the Backend process restarts
- **THEN** its event stream reports a new instance epoch so central performs Host-wide resynchronization
