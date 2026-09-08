## ADDED Requirements

### Requirement: Diagnostic Journal combines preserved legacy history and activity receipts

Journal SHALL be a diagnostic view combining immutable legacy `<root>/docs/journal.md` content with new automatic operation receipts under `<root>/.memon/activity/`. After cutover memon SHALL NOT append to or rewrite the legacy file. A missing legacy file SHALL be valid; receipt creation SHALL NOT seed a digest cursor. Legacy v1 root-level JOURNAL.md SHALL NOT become a fallback.

#### Scenario: Existing history survives cutover
- **WHEN** a native mutation records a new receipt
- **THEN** old docs/journal.md bytes are unchanged and an explicit diagnostic query can retrieve both historical entries and the new operation

### Requirement: Diagnostic events distinguish legacy Markdown and typed receipts

The legacy reader SHALL continue to parse `- <ISO8601 with offset> [TAG] <body>` lines and preserve unknown tags/content. New operation receipts SHALL use the typed activity-capture contract, not handcrafted Markdown prose. Debug output SHALL label legacy versus structured origin and never infer unavailable associations or human verification.

#### Scenario: Historical note has no entity reference
- **WHEN** a debug query reads a legacy NOTE without a parseable artifact reference
- **THEN** it is returned with unknown association rather than attached to a guessed Experiment

### Requirement: Native mutations couple source changes with guarded activity recording

Native non-readonly invocations SHALL automatically record their outcome while preserving research-write concurrency protection. Failure, conflict and no-op calls SHALL remain visible. Recording failure SHALL be explicit and SHALL NOT roll back a successful research write solely to repair diagnostics. Direct-file maintenance SHALL be submitted through CLI; agents SHALL NOT manipulate Journal storage.

#### Scenario: Receipt completion fails
- **WHEN** a native status mutation cannot persist its completion receipt
- **THEN** the caller receives an explicit recording failure, without rolling back an already successful research write merely to repair Journal

### Requirement: Typed operation identities preserve mutation lineage

Automatic records SHALL retain operation identity for experiment create/edit/delete, Run and Experiment status/archive, bind/unbind, rename and warning changes. New records SHALL carry typed identities and before/after references rather than rely on parsing free-text tags. The legacy reader SHALL continue to recognize EXPERIMENT, BIND, RENAME, WARNING, STATUS, EXP_STATUS and ARCHIVE events. One cascade SHALL produce one logical receipt.

#### Scenario: Rename cascade
- **WHEN** an Experiment rename updates its bound Run references
- **THEN** one receipt identifies old/new Experiment identity and the affected paths without emitting one independent event per helper

### Requirement: Journal is not a research knowledge workflow

Normal research agents SHALL NOT read, summarize, author or repair Journal prose. Research decisions, questions and findings SHALL go to Wiki/Experiment documents. Journal access SHALL be explicit diagnostic work; normal scans and research handoffs SHALL NOT load its history. No scheduler SHALL manufacture digest summaries or advance an unused cursor.

#### Scenario: Routine research resume
- **WHEN** an agent resumes an Experiment
- **THEN** it receives current source documents and relevant roadmap knowledge without an automatic Journal dump

## REMOVED Requirements

### Requirement: JOURNAL.md location
**Reason**: The redesigned workflow intentionally replaces the former contract, including its obsolete authoring/default-context scenarios.
**Migration**: Use "Diagnostic Journal combines preserved legacy history and activity receipts"; preserve historical user content and cut over every supported caller without a silent compatibility writer.

### Requirement: Event line format
**Reason**: The redesigned workflow intentionally replaces the former contract, including its obsolete authoring/default-context scenarios.
**Migration**: Use "Diagnostic events distinguish legacy Markdown and typed receipts"; preserve historical user content and cut over every supported caller without a silent compatibility writer.

### Requirement: Status changes are atomic README + JOURNAL writes
**Reason**: The redesigned workflow intentionally replaces the former contract, including its obsolete authoring/default-context scenarios.
**Migration**: Use "Native mutations couple source changes with guarded activity recording"; preserve historical user content and cut over every supported caller without a silent compatibility writer.

### Requirement: New event tags for experiment, binding, and rename
**Reason**: The redesigned workflow intentionally replaces the former contract, including its obsolete authoring/default-context scenarios.
**Migration**: Use "Typed operation identities preserve mutation lineage"; preserve historical user content and cut over every supported caller without a silent compatibility writer.

### Requirement: Frontmatter `last_digest_at` field
**Reason**: New activity has no digest cursor; legacy frontmatter is preserved as opaque historical metadata.
**Migration**: Leave old files untouched; remove new-file seeding, active cursor projection and mutation requirements.

### Requirement: Digest protocol
**Reason**: Journal is diagnostic operation history, not input to a mandatory summarization loop.
**Migration**: Remove cursor-driven digest authoring and retain existing digest read access.

### Requirement: `last_digest_at` write protection for non-digest writers
**Reason**: No supported workflow writes the retired cursor.
**Migration**: Remove digest-mark and all writers rather than create a second privileged cursor path.
