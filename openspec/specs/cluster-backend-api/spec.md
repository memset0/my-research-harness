# cluster-backend-api Specification

## Purpose
Define safe central in-process project services and public document contracts; the legacy capability name does not require a remote Backend listener.

## Requirements

### Requirement: Central services preserve Wiki document contracts

Wiki SHALL remain a document kind alongside Reports, using the public list/detail/write/review/asset contracts from wiki-store. Central SHALL resolve configured host-qualified projects directly to project services; no remote Backend listener, token or capability probe SHALL be necessary. List envelopes SHALL omit bodies and absolute paths; detail envelopes SHALL include content, hash and diagnostics. Runtime validation, read-only project-data policy and owner-only review marks SHALL remain enforced.

#### Scenario: List and detail preserve their envelopes
- **WHEN** central lists a configured project's Wiki and reads a page
- **THEN** the list contains summaries and the detail adds content/hash/diagnostics without absolute paths or a remote Backend request

#### Scenario: Conflicting write is refused
- **WHEN** expectedMtime or expectedHash no longer matches the Wiki file
- **THEN** the write returns a conflict with current document state and does not alter the file

#### Scenario: Review marks are owner-only
- **WHEN** a viewer requests a Wiki review mark
- **THEN** central denies it without modifying the mark file

#### Scenario: Read-only data rejects Wiki writes
- **WHEN** a configured read-only project receives a Wiki document write
- **THEN** central rejects it while preserving authorized list/detail reads; control-plane review permission is separately enforced

#### Scenario: Report kind keeps serving
- **WHEN** a project has Reports and Wiki pages
- **THEN** both kinds retain their own routes and envelopes

### Requirement: Wiki assets preserve bounded streaming

Central Wiki asset responses SHALL retain bounded streaming, range support, cancellation and path containment. Large assets SHALL not be expanded into JSON or eagerly loaded into the document-content cache. Ambiguous mutation failures SHALL not be automatically replayed.

#### Scenario: Large Wiki bundle asset remains streamed
- **WHEN** a client reads a large binary Wiki asset
- **THEN** bytes stream unchanged with bounded buffering

#### Scenario: Client disconnect cancels stream
- **WHEN** a client disconnects during asset transport
- **THEN** abandoned stream work is canceled without affecting other resources

### Requirement: Central service mutations record activity without peer negotiation

Supported non-readonly project-service invocations SHALL record automatic activity while enforcing owner authorization, read-only project policy and path safety. Direct document submissions SHALL remain CLI-owned. This surface SHALL NOT require a remote Backend or advertise unimplemented evidence-review endpoints.

#### Scenario: Read-only project refuses a mutation
- **WHEN** a request attempts to mutate a read-only configured project
- **THEN** central rejects the research write without a remote capability probe

### Requirement: Journal authoring endpoints are removed

Central manual journal-append routes SHALL be removed along with their advertised schemas/capabilities and client helpers. Automatic native mutation receipts SHALL remain supported. New receipt diagnostic reads SHALL be owner-only; existing legacy Journal read scope SHALL not expand to include these receipts.

#### Scenario: Retired append endpoint
- **WHEN** an old client POSTs manual Journal prose
- **THEN** the request is rejected without creating legacy content or an activity receipt

### Requirement: Retired service boundary does not remove safety
Central SHALL enforce exact project authorization, read-only data mode, separately authorized share administration, path containment, runtime-validated public data and bounded streaming. Browser credentials SHALL never be forwarded to remote command targets. Ambiguous mutation failures SHALL not be automatically replayed.

#### Scenario: Viewer mutation
- **WHEN** a viewer requests a document write or shell operation
- **THEN** central rejects it before file or command access

#### Scenario: Read only data
- **WHEN** a read-only project receives a document write
- **THEN** the write is rejected; share administration remains separately governed and physical write errors are surfaced

### Requirement: Central detail preserves the safe v6 document contract
Central Experiment detail SHALL preserve ordered raw sections, sanitized Implementation/Investigation/Results data, canonical projections, diagnostics, read-only state and Results update metadata including bounded column/value annotations. It SHALL omit absolute filesystem authority. Lists SHALL remain summary-only. This contract SHALL not require a Backend HTTP request.

#### Scenario: Valid detail
- **WHEN** an experiment bundle parses successfully
- **THEN** central returns the data needed for canonical sections and Results without absolute paths

#### Scenario: Summary list
- **WHEN** the user requests experiment summaries
- **THEN** managed document bodies are omitted
