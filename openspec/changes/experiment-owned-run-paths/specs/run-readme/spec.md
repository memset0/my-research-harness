## ADDED Requirements

### Requirement: FS v7 Runs do not persist Experiment ownership
For FS v7, the v6 optional `experiment` frontmatter field SHALL be retired. Serializers and authoring tools SHALL NOT emit it. Validation SHALL flag a remaining legacy field and SHALL NOT use it as ownership authority. Run ID and lifecycle fields remain Run-local; an unassigned Run is valid. Any displayed parent SHALL derive only from Experiment declarations.

#### Scenario: Run lacks parent field
- **WHEN** a valid v7 Run README has no `experiment` field
- **THEN** parsing succeeds without a missing-parent warning

#### Scenario: Conflicting legacy field
- **WHEN** a leftover Run field disagrees with the Experiment declaration
- **THEN** it is reported as an obsolete field and does not redirect membership
