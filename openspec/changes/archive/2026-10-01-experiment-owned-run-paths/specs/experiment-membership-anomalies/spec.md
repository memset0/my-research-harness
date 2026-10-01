## ADDED Requirements

### Requirement: FS v7 validation checks declarations rather than intersections
For FS v7, declaration validation SHALL replace the v6 bidirectional three-class model and confirmed-member intersection. It SHALL report malformed/unsafe paths, missing or unreadable targets, duplicate paths in one Experiment and the same path claimed by multiple Experiments. It SHALL NOT classify an unassigned Run or the absence of a Run parent field as an ownership anomaly. Unrelated Experiment identity checks remain in force.

#### Scenario: Two owners claim one path
- **WHEN** two Experiments list the same canonical Run path
- **THEN** validation reports both owners and refuses an operation that would create that conflict

#### Scenario: Missing member is not erased
- **WHEN** a declared member directory is missing
- **THEN** validation reports the missing target and preserves its declared membership for repair

### Requirement: Declaration anomaly records

The indexer SHALL produce in-memory anomaly records from Experiment declarations alone:

| Code | Trigger |
|---|---|
| `PHANTOM_RUN_REF` | an Experiment `runs[]` entry resolves to no Run directory, to a directory without a README, or to an ambiguous legacy base name |
| `MISMATCH_EXPERIMENT_REF` | the same Run path is declared by more than one Experiment |

`ORPHAN_RUN` remains in the wire code union for compatibility but SHALL NOT be emitted: an unassigned Run is valid. A legacy Run `experiment` field is reported by Run structural lint, never as a membership anomaly. Each record SHALL carry `code` (one of the codes above or a slug-uniqueness code), `project`, `runId` (the declared reference) when a Run is involved, `experimentId` when an Experiment is involved, a one-sentence `message` and `detectedAt` (ISO8601 with offset).

#### Scenario: PHANTOM_RUN_REF detected
- **GIVEN** an experiment `E0001-foo` with `runs: ["logs/bar-260502-100000"]` but that directory does not exist
- **WHEN** the indexer evaluates anomalies
- **THEN** the anomaly set contains a `PHANTOM_RUN_REF` record naming the exp and the missing path, and the declaration is kept

#### Scenario: Duplicate owners detected
- **GIVEN** `E0001-foo` and `E0002-bar` both declare `logs/qux-260503-100000`
- **WHEN** the indexer evaluates anomalies
- **THEN** each Experiment gets a `MISMATCH_EXPERIMENT_REF` record for that path and neither lists it as a confirmed member

#### Scenario: Unassigned Run is not an anomaly
- **GIVEN** a Run that no Experiment declares
- **WHEN** the indexer evaluates anomalies
- **THEN** no anomaly record names that Run

### Requirement: Anomaly recompute on declaration change

The system SHALL re-evaluate a project's anomalies whenever an Experiment document changes, is created or is deleted, and whenever a Run directory appears or disappears. Editing a Run README SHALL NOT change ownership, so it needs no ownership recompute beyond refreshing that Run's displayed data.

#### Scenario: Declaration moves a Run
- **GIVEN** `E0001` declares `logs/r-260501-100000`
- **WHEN** the path is removed from `E0001.runs[]` and added to `E0002.runs[]`
- **THEN** the next recompute shows the Run under `E0002` only, with no anomaly

## MODIFIED Requirements

### Requirement: Slug-uniqueness anomalies

The membership join SHALL surface three v3 slug-uniqueness anomaly
codes in addition to the declaration anomalies (`PHANTOM_RUN_REF`,
`MISMATCH_EXPERIMENT_REF`). These live on the
same `ExperimentMembershipAnomaly` shape (same `code` / `project` /
`runId` / `experimentId` / `message` / `detectedAt` fields) and
appear in the same `/api/anomalies` surface and in structural lint:

| Code | Severity | Trigger |
|---|---|---|
| `DUPLICATE_EXPERIMENT_SLUG` | error | two exp docs share the same slug — normally impossible (the create-time allocator forbids it), but possible if someone manually copies a file |
| `EXPERIMENT_SLUG_PREFIX_COLLISION` | error | one exp slug is a prefix of another (e.g. `fsdp` and `fsdp-collective`) — ambiguous when resolving run ids by prefix to their parent exp |
| `RUN_SLUG_PREFIX_VIOLATION` | info | a declared member run's slug doesn't start with its declaring exp's slug; the CLI emits this as a soft warning at link-time and it surfaces here for already-declared runs too |

Each anomaly emits a record per OFFENDING entity (e.g.
`DUPLICATE_EXPERIMENT_SLUG` emits one record per colliding exp doc,
not one record for the pair).

Run slugs MAY repeat across timestamps within a project — there is
NO `DUPLICATE_RUN_SLUG` code (see `run-discovery` delta in this
change). Only EXPERIMENT slug uniqueness is enforced.

#### Scenario: DUPLICATE_EXPERIMENT_SLUG detected
- **GIVEN** two exp docs `E0001-fsdp` and `E0002-fsdp` (both `slug: fsdp`)
- **WHEN** the indexer evaluates anomalies
- **THEN** the anomaly set contains TWO `DUPLICATE_EXPERIMENT_SLUG`
  records — one with `experimentId: E0001-fsdp`, one with
  `experimentId: E0002-fsdp` — so per-id views surface the issue

#### Scenario: EXPERIMENT_SLUG_PREFIX_COLLISION detected
- **GIVEN** exp docs `E0001-fsdp` (`slug: fsdp`) and `E0002-fsdp-collective`
  (`slug: fsdp-collective`)
- **WHEN** the indexer evaluates anomalies
- **THEN** the anomaly set contains
  `EXPERIMENT_SLUG_PREFIX_COLLISION` records naming both exp docs

#### Scenario: RUN_SLUG_PREFIX_VIOLATION detected
- **GIVEN** an exp `E0001-fsdp` whose `runs[]` includes
  `attention-260501-100000` (run slug "attention" doesn't start with
  exp slug "fsdp"), declared by no other Experiment
- **WHEN** the indexer evaluates anomalies
- **THEN** the anomaly set contains a `RUN_SLUG_PREFIX_VIOLATION`
  record naming the exp + the run

#### Scenario: Run slug repeat across timestamps does not fire
- **GIVEN** runs `foo-260501-100000` and `foo-260601-200000` both
  declared by `E0001-foo`
- **WHEN** the indexer evaluates anomalies
- **THEN** NO `DUPLICATE_RUN_SLUG` (or any other slug-collision
  anomaly) record is emitted for the pair — run slugs MAY repeat
  across distinct timestamps

## REMOVED Requirements

### Requirement: Three anomaly classes
**Reason**: The v6 bidirectional classes compare the Run-side `experiment` field with Experiment declarations; FS v7 has no Run-side field.
**Migration**: See "Declaration anomaly records" and "FS v7 validation checks declarations rather than intersections".

### Requirement: Membership is the intersection
**Reason**: Membership is the Experiment declaration in FS v7, not an intersection with a Run claim.
**Migration**: See "FS v7 Experiment declarations own membership" in `experiment-readme`.

### Requirement: Anomaly recompute on mtime change
**Reason**: Run README edits no longer move ownership.
**Migration**: See "Anomaly recompute on declaration change".
