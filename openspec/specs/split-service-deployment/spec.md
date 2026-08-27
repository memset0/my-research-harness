# split-service-deployment Specification

## Purpose
Defines independently deployable central, cluster-backend, and compatible standalone roles without committing environment-specific deployment state.

## Requirements

### Requirement: Central, Backend, and standalone roles have explicit boundaries
The system SHALL provide a central role that owns the Web UI, human authentication, authorization, aggregation, and gateway; a Backend role that owns cluster-local Projects, filesystem access, events, and cluster tools; and a standalone role that preserves the co-located single-process product by composing the same service layer. A process SHALL NOT run central and Backend role blocks from one instance configuration.

#### Scenario: Central starts without Project roots
- **WHEN** an instance configuration selects the central role and contains no local Project roots
- **THEN** the central Web/gateway starts and obtains Project data only from configured Backends

#### Scenario: Backend starts without human auth
- **WHEN** an instance configuration selects the Backend role with Projects and service authentication
- **THEN** the Backend starts without serving the Web UI or initializing browser-facing credentials

#### Scenario: Existing standalone configuration remains usable
- **WHEN** an instance configuration contains neither a central nor Backend block
- **THEN** memon preserves the existing standalone Web-plus-Backend behavior and project-only routes

### Requirement: Central and Backend are independently buildable and installable
The central and Backend roles SHALL have separate build outputs and runtime dependency sets. A central-only Patch release SHALL be installable without building or reinstalling a Backend, and a Backend distribution SHALL NOT require the Web frontend build.

#### Scenario: Central Patch deployment leaves Backend artifact unchanged
- **WHEN** a Patch release is deployed to central
- **THEN** every installed Backend artifact remains byte-unchanged and compatible

### Requirement: Production local Backend is explicit
A central Host MAY run a separately configured local Backend, but production central startup SHALL NOT implicitly register repository mock Projects. Development/test mock Projects SHALL use an explicitly started Backend and the same authenticated API and Host-qualified routing as remote Projects.

#### Scenario: Production central has no implicit mocks
- **WHEN** central starts without an explicitly configured local Backend Host entry
- **THEN** no repository mock Project appears in its Project list

### Requirement: Concrete deployment state remains local
Tracked examples and OpenSpec artifacts SHALL contain only generic schema and synthetic values. Real Host identities, domains, addresses, ports, SSH details, paths, tokens, and runbook notes SHALL remain in selected Git-ignored instance configurations or machine-local service/proxy configuration.

#### Scenario: Repository audit finds no fleet secret or topology
- **WHEN** tracked change artifacts, examples, tests, and deployment templates are inspected
- **THEN** they contain no real fleet credential or environment-specific connection value introduced by this change

### Requirement: Bootstrap prevents two public writable control planes
The first standalone-to-split migration SHALL support a private candidate Backend and candidate central service alongside the live standalone service. Candidate mutation and terminal capabilities SHALL remain disabled until a quiesced cutover, and at most one public writable control plane SHALL be active for a Project at any time.

#### Scenario: Candidate read verification does not create a second writer
- **WHEN** the candidate Backend is being shadow-verified while legacy standalone remains public
- **THEN** candidate metadata and reads work but its mutation and terminal-creation operations are rejected

#### Scenario: Failed cutover restores the legacy path
- **WHEN** post-switch verification fails
- **THEN** new writes are quiesced, the prior ingress and legacy process are restored and verified, and only then are candidate processes stopped
