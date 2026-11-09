## Purpose

Allow owner feedback to reach project files through a narrowly scoped, concurrency-safe append operation across native, SSHFS and File Agent access.

The total encoded event budget is 4096 bytes; owner-authorized lifecycle edits use the bounded replacement grant described below.

## ADDED Requirements

### Requirement: Append preserves the observed log prefix
An append SHALL carry expectedSize, one complete newline-terminated UTF-8 JSON line of at most 4096 bytes, and a replay identity for agent transport. The writer SHALL check size under its common writer lock, preserve every existing byte and create only a missing target whose expectedSize is zero. A mismatch SHALL return CONFLICT without writing. Replay SHALL NOT append twice.

#### Scenario: Two writers race
- **WHEN** two requests append against the same observed size
- **THEN** one succeeds and the other conflicts; re-reading and retrying preserves both complete lines

#### Scenario: Missing response log
- **WHEN** an append targets a missing responses.jsonl with expectedSize zero
- **THEN** the file is created with exactly the supplied complete line

### Requirement: Scoped File Agent grants admit only discussion log appends
A read-edit grant SHALL admit append only at `docs/discussions/D<NNNN>-<slug>/responses.jsonl`, without destinations, file checks, mode or recursion. Existing project readOnly, containment, writer-lock version and replay checks SHALL apply. Read grants SHALL still refuse mutations. The File Agent SHALL advertise `scoped-append-v1`; absent capability SHALL produce actionable upgrade guidance.

#### Scenario: Append escapes the scope
- **WHEN** a read-edit principal appends to a README, nested asset, arbitrary path or oversized/multiline payload
- **THEN** the operation is refused and no file changes

### Requirement: Central response allowance is capability-specific
Central configuration SHALL accept `discussion` in allowed_edits. Read-only Projects SHALL permit response append only with that allowance; title allowance SHALL NOT grant it. Owner response routes SHALL apply this gate through both host-qualified backend routing and ordinary Next handlers. Other writes SHALL remain read-only, including catalog and README replacement.

#### Scenario: Host-qualified response
- **WHEN** the owner responds through a host-qualified API on a read-only Project allowing discussion edits
- **THEN** only its response log is appended and the same Project still refuses generic document writes

#### Scenario: Unconfigured allowance
- **WHEN** the Project allows title edits but not discussion edits
- **THEN** response append returns 403 without mutation

### Requirement: Retry reconciles log size without replaying an uncertain write
Central SHALL retry a bounded number of explicit size conflicts after re-reading the log. It SHALL preserve the logical response identity across retry and return an existing identical response when already applied. Uncertain transport errors SHALL retain their replay identity or be reported for recovery rather than silently duplicating feedback.

#### Scenario: Concurrent response arrives first
- **WHEN** another valid response changes the log size before this response is appended
- **THEN** central re-reads and retries its original response without removing or duplicating either answer

### Requirement: Scoped lifecycle edits preserve unrelated content
A read-edit File Agent grant SHALL also admit guarded replacements at canonical discussion README and discussions.json catalog paths under the existing 4096-byte changed-span limit. Central SHALL restrict browser lifecycle edits to OPEN/CLOSED status and catalog status/mtime only. Discussion allowance SHALL NOT grant generic document edits or DRAFT publication.

#### Scenario: Close on a read-only Project with the discussion allowance
- **WHEN** the owner closes a published discussion on an allowed read-only Project
- **THEN** bounded status/catalog replacements succeed while unrelated writes remain refused
