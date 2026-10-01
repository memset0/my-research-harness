## ADDED Requirements

### Requirement: Digest is an ordinary Wiki kind

The registry SHALL define `digest` as a time-window summary of progress, evidence
and unresolved questions, distinct from a durable finding or meeting record.
It SHALL have no workflow status or mandatory heading scaffold. Core, CLI, Web
help/filter and generated guidance SHALL recognize it through the shared config.

#### Scenario: Digest guidance and creation
- **WHEN** a user lists kinds, opens Help or creates a digest Wiki page
- **THEN** the ordinary registry-driven Wiki behavior applies without a separate Digest API
