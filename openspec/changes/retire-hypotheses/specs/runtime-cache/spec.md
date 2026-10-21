## ADDED Requirements

### Requirement: Retired hypothesis data is outside normal runtime work
Normal runtime operations SHALL NOT read, parse, cache, poll, prewarm or count the retired hypotheses document. Health and resource inventories SHALL omit it. Wiki projection and project discovery SHALL work even if that document is unreadable.

#### Scenario: Unreadable historical file
- **WHEN** the retired file is unreadable while current documents are readable
- **THEN** project, experiment and Wiki reads succeed without accessing it
