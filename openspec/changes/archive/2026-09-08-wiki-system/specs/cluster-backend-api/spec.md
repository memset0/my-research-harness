## ADDED Requirements

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
