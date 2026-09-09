## ADDED Requirements

### Requirement: Skills author and migrate v7 membership consistently
Managed Run, Experiment, analysis/report and migration skills SHALL teach Experiment-only path declarations and SHALL NOT write Run ownership fields or prescribe bidirectional repair for v7. They SHALL distinguish membership from result/provenance semantics, use path-qualified references when needed, preserve FS preflight checks, and require explicit reviewed migration application. Generated examples SHALL use neutral project-relative paths.

#### Scenario: Skill creates a Run for an Experiment
- **WHEN** a skill creates and records a v7 Run
- **THEN** it records the Run's project-relative path in the Experiment and does not add `experiment` to the Run README

#### Scenario: Skill encounters legacy project
- **WHEN** a v7 authoring skill sees a v6 project
- **THEN** it directs the user to the reviewed migration procedure instead of updating the version marker or relationship fields opportunistically
