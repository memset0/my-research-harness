# host-qualified-project-identity Specification

## Purpose
Defines stable Host-qualified Project and resource identity across central routes, APIs, authorization, events, caches, and UI state.

## Requirements

### Requirement: Host rename and Project move are explicit identity migrations
Changing a configured Host ID or moving a Project to another Host SHALL create a different public identity. The system SHALL NOT infer transparent aliases; any redirect or share migration SHALL be explicitly configured and reviewed.

#### Scenario: Project move does not inherit viewer scope
- **WHEN** a viewer is scoped to `{host-a, project-x}` and the Project later appears on Host B
- **THEN** that viewer does not automatically gain `{host-b, project-x}` access

### Requirement: Configured namespace and project identify mounted resources
Existing central project identities SHALL remain {host, project}, using the stable configured host namespace rather than a transient hostname. The namespace SHALL NOT require a Backend service and SHALL map to an explicit central-accessible project root. Standalone project identity remains unchanged.

#### Scenario: Equal project names
- **WHEN** two namespaces contain project-a
- **THEN** their file cache, queries and authorization remain distinct despite central storage access

### Requirement: Central routes retain namespace-qualified targets without Backend probes
Existing central /h/<host>/p/<project>/ routes and /share/<host>/<project>/<token> links SHALL retain exact configured identity validation. Public API selectors SHALL not be replaced by raw paths and SHALL not require a live Backend.

#### Scenario: No Backend identity probe
- **WHEN** an existing scoped experiment URL is opened
- **THEN** central resolves its configured root without probing a remote application service

### Requirement: Namespace identity flows through resource polling state
All client requests, resource versions, query/local persistence keys, share scopes and execution targets SHALL retain exact project namespace. Foreground heartbeat responses replace document/list event identities; no name-only key may mix equal-name projects.

#### Scenario: Polling isolation
- **WHEN** two namespaces have equal experiment IDs
- **THEN** a version change for one does not refresh or authorize the other

### Requirement: Legacy navigation resolves configured identities without Backend liveness
Existing project-only navigation SHALL resolve only an explicit standalone project or an unambiguous configured mapping. It SHALL not guess among namespaces or require a live Backend to decide identity.

#### Scenario: Ambiguous project
- **WHEN** a legacy project-only URL matches two namespaces
- **THEN** navigation fails safely or displays selection rather than choosing the first
