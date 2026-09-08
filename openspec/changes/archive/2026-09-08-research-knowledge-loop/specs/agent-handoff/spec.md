## ADDED Requirements

### Requirement: Research handoff context is source-based by default

A normal research handoff SHALL contain the artifact identity/path, current frontmatter highlights, source-document references, relevant roadmap/decision references when available, the requested research action, and Chinese-response guidance. It SHALL NOT read or inject Journal events by default. A debugging handoff MAY explicitly request a bounded diagnostic history slice and SHALL label it operational context rather than scientific truth. Context SHALL be deterministic for the captured source state and missing Wiki context SHALL be reported honestly.

#### Scenario: Normal prompt ignores history growth
- **WHEN** only diagnostic history changes while the research documents and user intent are unchanged
- **THEN** the normal generated research prompt is unchanged

#### Scenario: Debug prompt is explicit
- **WHEN** the owner requests a debug handoff with recent failed operations
- **THEN** the prompt includes only the selected bounded diagnostic slice, without credentials or full environment dumps

## REMOVED Requirements

### Requirement: Generated prompt content
**Reason**: The redesigned workflow intentionally replaces the former contract, including its obsolete authoring/default-context scenarios.
**Migration**: Use "Research handoff context is source-based by default"; preserve historical user content and cut over every supported caller without a silent compatibility writer.
