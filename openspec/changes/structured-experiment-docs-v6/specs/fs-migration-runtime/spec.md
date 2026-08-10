## MODIFIED Requirements

### Requirement: Semantic migrations may require staged per-item approval

When a migration guide declares staged semantic review, `memon-migrate-fs` SHALL generate candidates in a persistent gitignored staging directory and SHALL NOT mutate live data during drafting. It SHALL record source/staged hashes and per-item approval. Source changes invalidate approval. It SHALL publish only after every item is approved, final validation succeeds, and the user gives final confirmation. It SHALL update the global FS marker last.

#### Scenario: One unapproved experiment prevents publication
- **GIVEN** all but one staged Experiment are approved
- **WHEN** the migration is resumed
- **THEN** no live Experiment is replaced and the FS marker remains unchanged

#### Scenario: Source changes cannot bless an old candidate
- **GIVEN** an Experiment candidate was generated from a recorded source bundle
- **WHEN** its Experiment README or any referenced Run README changes
- **THEN** the old candidate becomes `STALE`
- **AND** it cannot be reapproved without starting new staging from the changed source

#### Scenario: Candidates fail before production copy
- **GIVEN** every candidate has an approval hash but one staged bundle fails validate or lint
- **WHEN** final publication is requested
- **THEN** isolated staged validation fails before any live file or backup is written
- **AND** the FS marker remains unchanged
