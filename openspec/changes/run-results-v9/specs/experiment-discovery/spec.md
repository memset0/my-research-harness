## MODIFIED Requirements

### Requirement: Experiment list rows are slim summaries

`GET /api/experiments` without `inventory=1` SHALL return one row per
Experiment built from that Experiment's `README.md` alone (or its tolerated
legacy single file); it SHALL NOT read the managed YAML documents, the
description file `experiment.json`, the Results summary, or any Run or Run
result file.
Each row SHALL carry exactly: `id`, `project`, `resource`, `readmeMtime`,
`frontMatter` with `id`, `slug`, `title`, `status`, `archived`, `tags`,
`createdAt` and `updatedAt`, the counts `runCount` (declared `runs` entries),
`hypothesisCount` and `openWarningCount` (Warnings rows whose status is
`OPEN`), `parseErrors`, `parseWarnings`, `effectiveCreatedAt` and
`effectiveUpdatedAt`. A row SHALL NOT carry section bodies, `warningsRaw`, the
bundle activity `mtime`, or the `frontMatter.runs` / `frontMatter.hypotheses`
arrays. Consumers that need those fields SHALL request the Experiment detail.
An Experiment folder without `README.md` SHALL still produce a row whose
`parseErrors` names `MISSING_README`; a legacy file SHALL carry the
`LEGACY_LAYOUT` warning and a folder/file collision the `MIGRATION_COLLISION`
warning, as discovery does today.

#### Scenario: List row omits bodies
- **GIVEN** an Experiment whose README has long Motivation and Findings sections and declares 448 Runs
- **WHEN** the client requests the Experiment list
- **THEN** its row carries the title, status, tags, effective times and `runCount: 448`
- **AND** the row has no `sections`, `warningsRaw`, `mtime` or `frontMatter.runs`

#### Scenario: Detail is unchanged
- **WHEN** the client requests `GET /api/experiments/<id>`
- **THEN** the response still carries `frontMatter.runs`, sections, `warningsRaw` and the managed documents

#### Scenario: Managed YAML is not read for the list
- **WHEN** the list is built
- **THEN** no `implementation.yaml`, `investigation.yaml`, `experiment.json`, Results summary or `result.csv` is opened or stat'ed
