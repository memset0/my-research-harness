## Purpose

Allow agents to publish maintained knowledge and time-scoped reports as independent Markdown, HTML or live-service folders without imposing a presentation or execution workflow.

## ADDED Requirements

### Requirement: Content metadata is independent of presentation
Wiki and Report content SHALL accept title, description, category, created_at, updated_at, freshness CURRENT or STALE, stale_reason, as_of and source_commits. New timestamps SHALL include the writer's local offset. Markdown SHALL store metadata in README frontmatter; HTML and service folders SHALL store metadata in manifest.json with type html or service. HTML SHALL default to index.html; services SHALL declare a valid loopback port. Unknown extension metadata SHALL survive writes. Malformed metadata SHALL produce a readable diagnostic or explicit error, never a usable arbitrary proxy target.

#### Scenario: HTML without a Markdown adapter
- **WHEN** a folder contains a valid html manifest and index.html but no README
- **THEN** navigation lists it and opening it renders the HTML and relative assets directly

#### Scenario: Time-scoped freshness
- **WHEN** a Report declares STALE with a reason and an evidence cutoff with source commits
- **THEN** the list/detail expose staleness separately from evidence validity and service availability
- **AND** unrelated Git changes or elapsed time do not change the declaration

### Requirement: Readers can organize all presentations
Both content lists SHALL support category filtering and freshness filtering and show presentation type. Detail SHALL expose evidence cutoff/revisions when declared. Live services SHALL have an on-demand availability view with offline recovery; opening a page SHALL never build, install or start the application.

#### Scenario: Browse a topic
- **WHEN** a reader filters a topic containing Markdown, HTML and services
- **THEN** all matching presentations remain available in the same list

### Requirement: Dynamic content uses authenticated source forwarding
The server SHALL forward streaming HTTP and WebSocket traffic to the manifest-declared service through the configured local, SSHFS or File Agent access mode. Browser input SHALL NOT select arbitrary hosts or ports. Central authentication credentials SHALL NOT reach upstream applications. File Agent forwarding SHALL enforce mTLS project grants, source pinning and an operator service-port allowlist. Dynamic application access SHALL require owner authentication, since application requests need not be read-only. Path escapes and invalid manifests SHALL fail before connecting. Offline services SHALL return a recoverable unavailable response without application execution.

#### Scenario: Transport parity
- **WHEN** an owner opens the same service via native, SSHFS and File Agent projects
- **THEN** response bytes, streaming and WebSocket behavior are preserved through each transport
- **AND** an offline service does not launch automatically

#### Scenario: Unauthorized port
- **WHEN** a File Agent client requests a port absent from that project's allowlist
- **THEN** forwarding is refused even when the client can read the project's files

#### Scenario: Browser credentials
- **WHEN** a request authenticated with memon cookies or Basic credentials reaches the gateway
- **THEN** those credentials are consumed centrally and omitted from the forwarded application request

### Requirement: Authoring guidance supports agent-owned content
Skills SHALL distinguish maintained Wiki from time-scoped Report, allow freely authored HTML, and describe only necessary metadata, relative paths and service base-prefix configuration. Agents SHALL own generation and service lifecycle. Migration preparation SHALL preserve historical references and separate invalid evidence from superseded or less precise evidence.

#### Scenario: Migration review
- **WHEN** preparing a project migration
- **THEN** a per-document plan exposes destination, rewrite scope, reasons and unresolved decisions before source data is moved

### Requirement: Retired Reports retain their effective historical time
When Wiki material becomes a historical Report, created_at SHALL record when its retained content was last effective and updated_at SHALL record the current retirement or maintenance time, both with explicit local offsets. The effective time SHALL be based on content and history rather than automatically copying the Wiki creation date. Source commits SHALL identify actual revisions relevant to that historical content; a nearby actual revision MAY be used with explicit approximate provenance when exact correspondence is unavailable.

#### Scenario: Late retirement of an updated Wiki
- **WHEN** a Wiki created early was substantively updated later and is retired now
- **THEN** the Report records the appropriate last-effective historical time as created_at and now as updated_at
- **AND** any approximation of the effective revision is labeled without fabricating a hash
