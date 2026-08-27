# host-qualified-project-identity Specification

## Purpose
Defines stable Host-qualified Project and resource identity across central routes, APIs, authorization, events, caches, and UI state.

## Requirements

### Requirement: Project identity is a Host and Project tuple
Central mode SHALL represent a Project as `{ host, project }`, where Host is a stable configured ID matching `[a-z0-9][a-z0-9-]*`. Resource and terminal references SHALL include that Project tuple plus their local ID. The stable Host ID SHALL NOT be derived from a transient OS hostname.

#### Scenario: Same Project name exists on two Hosts
- **WHEN** Host A and Host B each expose `project-x`
- **THEN** central represents two distinct Project references and neither shadows the other

### Requirement: Central routes and APIs require Host-qualified targets
Canonical central browser routes SHALL use `/h/<host>/p/<project>/...`, and new share routes SHALL use `/share/<host>/<project>/<token>`. Every central Project-scoped API, including historically ID-only routes, SHALL require validated Host and Project selectors. Missing or unknown selectors SHALL fail without Backend broadcast.

#### Scenario: ID-only collision remains isolated
- **WHEN** the same run ID exists under equal Project names on two Hosts
- **THEN** the central URL/API target selects exactly one `{host, project, run}`

### Requirement: Host identity flows through client and event state
SSR parameters, fetch inputs, response DTOs, TanStack query keys, localStorage keys, BroadcastChannel messages, SSE payloads, share scopes, report links, and terminal state SHALL contain Host wherever they identify cluster data. Name-only cache or persistence keys SHALL NOT be used in central mode.

#### Scenario: Event invalidates only its Host
- **WHEN** Host A emits a change for `project-x`
- **THEN** Host A's matching queries invalidate and Host B's equal-name Project cache remains unchanged

### Requirement: Legacy project-only navigation fails safely
During bootstrap, a legacy project-only browser URL MAY redirect only when exactly one live Host matches. An ambiguous or unavailable match SHALL show a chooser/error and SHALL NOT select the first Host. Standalone mode SHALL retain existing project-only URLs.

#### Scenario: Ambiguous legacy URL does not guess
- **WHEN** a legacy `/p/project-x` URL matches two Hosts
- **THEN** central asks for a Host or reports ambiguity without loading either Project

### Requirement: Host rename and Project move are explicit identity migrations
Changing a configured Host ID or moving a Project to another Host SHALL create a different public identity. The system SHALL NOT infer transparent aliases; any redirect or share migration SHALL be explicitly configured and reviewed.

#### Scenario: Project move does not inherit viewer scope
- **WHEN** a viewer is scoped to `{host-a, project-x}` and the Project later appears on Host B
- **THEN** that viewer does not automatically gain `{host-b, project-x}` access
