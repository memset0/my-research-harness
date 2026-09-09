## ADDED Requirements

### Requirement: FS v7 validation checks declarations rather than intersections
For FS v7, declaration validation SHALL replace the v6 bidirectional three-class model and confirmed-member intersection. It SHALL report malformed/unsafe paths, missing or unreadable targets, duplicate paths in one Experiment and the same path claimed by multiple Experiments. It SHALL NOT classify an unassigned Run or the absence of a Run parent field as an ownership anomaly. Unrelated Experiment identity checks remain in force.

#### Scenario: Two owners claim one path
- **WHEN** two Experiments list the same canonical Run path
- **THEN** validation reports both owners and refuses an operation that would create that conflict

#### Scenario: Missing member is not erased
- **WHEN** a declared member directory is missing
- **THEN** validation reports the missing target and preserves its declared membership for repair
