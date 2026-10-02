## ADDED Requirements

### Requirement: Results Status column distinguishes and orders Variant statuses

The Results table SHALL render each Variant status as a badge whose text is the status name and whose style is distinct in both light and dark themes: `PLANNED` slate, `BLOCKED` orange with a dashed outline, `RUNNING` sky, `COMPLETED` emerald, `FAILED` red, `INCONCLUSIVE` amber, and `DROPPED` stone. Sorting by the Status column, whether as a default-sort rule or as a temporary header sort, SHALL order Variants by the canonical lifecycle order `PLANNED`, `BLOCKED`, `RUNNING`, `COMPLETED`, `FAILED`, `INCONCLUSIVE`, `DROPPED` when ascending and by its reverse when descending, followed by the usual tie-breakers; it SHALL NOT sort statuses alphabetically. Status row filters SHALL keep comparing the status text.

#### Scenario: Blocked badge
- **GIVEN** a Results document with a `BLOCKED` Variant
- **WHEN** the Results table renders
- **THEN** that row's Status cell shows a `BLOCKED` badge
- **AND** its style differs from the `FAILED`, `INCONCLUSIVE` and `PLANNED` badges

#### Scenario: Status sorts by lifecycle order
- **GIVEN** Variants with the statuses `DROPPED`, `RUNNING`, `BLOCKED`, `PLANNED` and `COMPLETED`
- **WHEN** the user sorts the Status column ascending
- **THEN** the rows appear in the order `PLANNED`, `BLOCKED`, `RUNNING`, `COMPLETED`, `DROPPED`
- **AND** sorting descending shows `DROPPED`, `COMPLETED`, `RUNNING`, `BLOCKED`, `PLANNED`
