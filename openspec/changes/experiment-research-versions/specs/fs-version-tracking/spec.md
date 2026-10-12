## ADDED Requirements

### Requirement: FS10 declares a structurally incompatible research-aware description

The reviewed release of research-version support SHALL set `FS_CONVENTION_VERSION` to 10 with initial release `10.0.0` and a conforming `v9-to-v10.md` migration guide. FS10 `experiment.json` SHALL use a Variant registry keyed by stable ID and explicit research metadata while preserving the independent `experiment_schema_version`. The stored shape SHALL be rejected by FS9 array-only description readers; merely adding optional fields or a minimum-reader field ignored by old readers SHALL NOT satisfy compatibility safety.

#### Scenario: Old parser sees new description
- **WHEN** a released FS9 parser reads an FS10 description
- **THEN** it rejects the Variant shape instead of returning a current Results table containing obsolete Runs

### Requirement: FS9 conversion is explicit and preserves source evidence

FS10 tooling SHALL provide a labeled legacy mode for FS9 arrays preserving existing read/write behavior. Migration SHALL require explicit execution and reviewed changes, preserve stable IDs/order and custom fields, preserve all Run/result file bytes, initialize existing member attribution to version 1, retain frozen values in that initial version, and leave frozen attempts excluded. Conversion SHALL NOT infer historical scientific boundaries or certify legacy results. Validation SHALL precede marker finalization; failure SHALL restore backups rather than claim FS10. Deployment SHALL NOT run this migration automatically.

#### Scenario: Convert an existing Experiment
- **WHEN** the approved FS9-to-FS10 conversion runs
- **THEN** the registry and version metadata are introduced without changing Run execution state, Run results, Variant identity, or resurrecting frozen attempts

#### Scenario: Upgrade software only
- **WHEN** the new tool is installed against an FS9 project
- **THEN** existing research files and the FS marker remain unchanged and migration-dependent operations report the required explicit conversion

### Requirement: Explicit FS10 lifecycle normalization preserves source evidence

The approved FS10 refinement SHALL update the v9-to-v10 guide/conversion to normalize Experiment lifecycle using a reviewed explicit mapping, including ambiguous archived and resolved legacy cases. A separate explicit normalization path SHALL support already-FS10 projects from the initial release. No read or software deployment SHALL rewrite lifecycle. Conversion SHALL preserve Experiment body and Run/result bytes, retain exact preimages for rollback, and verify all four-state records before publishing its completion. FS convention remains 10 as explicitly approved for this refinement; writers supporting the refined lifecycle SHALL be deployed before its project application.

#### Scenario: Legacy archived state is ambiguous
- **WHEN** conversion finds a legacy archived Experiment without a reviewed lifecycle decision
- **THEN** it reports the needed decision rather than assuming PAUSED, ARCHIVED or RETIRED
