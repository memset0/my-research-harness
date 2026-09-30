## ADDED Requirements

### Requirement: Membership derives from Experiment declarations

The system SHALL compute, for each experiment, its member Runs from its `runs[]` declarations only. A declared path that resolves to exactly one Run directory under a supported Run root, and that no other Experiment declares, is a confirmed member; a legacy bare base name counts only when it is unique. A Run README `experiment` field SHALL NOT add, remove or redirect membership. The join SHALL still produce the anomalies per `experiment-membership-anomalies` and the effective times per `experiment-readme`. A displayed parent for a Run is the single Experiment that declares it, or none.

#### Scenario: Confirmed member shows in membership
- **GIVEN** `E0001.runs: ["logs/r1-260501-100000"]` and that Run directory exists without an `experiment` field
- **WHEN** the join runs
- **THEN** `E0001`'s confirmed members include `logs/r1-260501-100000` and no anomaly is emitted

#### Scenario: Legacy Run-side claim is ignored
- **GIVEN** Run `logs/r2-260501-100000` still carries `experiment: E0001` but no Experiment declares it
- **WHEN** the join runs
- **THEN** it is not a member of `E0001`, it has no displayed parent, and only Run lint reports the obsolete field

## REMOVED Requirements

### Requirement: Membership computation joins exp and run indices
**Reason**: The v6 join requires the Run `experiment` field to agree with the Experiment declaration; FS v7 retires that field.
**Migration**: See "Membership derives from Experiment declarations".
