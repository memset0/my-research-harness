## MODIFIED Requirements

### Requirement: Standalone Results snapshot reports invalid results with the central status

`GET /api/experiments/:id/results` SHALL answer the Experiment's generated Results summary (regenerated when stale) with the same status and body shape in standalone and central mode. A description file that exists but fails to parse or validate SHALL answer `400` with `{"error":{"code":"INVALID_RESULTS","message":…},"diagnostics":[…],"updatedAt":…}`. A summary that fails because member result files record another or no `experiment_schema_version`, or contain a duplicate `(path, stat)` pair, SHALL answer `422` with code `RESULT_SCHEMA_MISMATCH` or `RESULT_DUPLICATE_ROW`, the offending project-relative files with their recorded versions or duplicate lines, and for a mismatch the upgrade command; it SHALL NOT include any Variant row. A missing description file SHALL answer `404` `RESULTS_NOT_FOUND`. A legacy `results.yaml` SHALL NOT be read by this route.

#### Scenario: Malformed results.yaml in standalone
- **GIVEN** a v9 Experiment with a valid `experiment.json` and a leftover `results.yaml` that is not valid YAML
- **WHEN** a standalone client requests its Results snapshot
- **THEN** the response is `200` with the summary generated from `experiment.json`, and the leftover file is neither read nor reported as `INVALID_RESULTS`

#### Scenario: Malformed description file in standalone
- **GIVEN** an Experiment whose `experiment.json` is not valid JSON
- **WHEN** a standalone client requests its Results snapshot
- **THEN** the response is `400` with code `INVALID_RESULTS` and the parser diagnostics, the same status central returns

#### Scenario: Schema mismatch in central
- **GIVEN** an Experiment whose description file records version 2 and one member `result.csv` records version 1
- **WHEN** central serves its Results snapshot
- **THEN** the response is `422` with code `RESULT_SCHEMA_MISMATCH`, that file and the command `memon experiment schema upgrade <experiment-id> --to 2`, and no Variant rows

## ADDED Requirements

### Requirement: Experiment detail stays within its bounds for large Experiments

The Experiment detail response SHALL NOT fail because an Experiment's sources are large. Its Results display section SHALL carry a bounded digest of the generated Results summary (experiment schema version, Variant, column and group counts, frozen-value count, non-info diagnostic codes, the failure callout of a failed summary, and a pointer to the Results snapshot endpoint and `memon experiment results table`), never the full Results table. The detail SHALL embed the Results summary only when its serialized size is at most 256 KiB; a larger summary SHALL be answered as `summary: null` with `summaryDeferred: {bytes, limit}`, and clients SHALL read it from the Results snapshot endpoint. A README body, display section body or raw section body longer than its protocol bound SHALL be truncated to that bound with a visible notice naming the source file and a `BODY_TRUNCATED` or `SECTION_TRUNCATED` warning diagnostic, instead of failing the response. Truncation SHALL affect only the response; source files SHALL NOT be modified. The behavior SHALL be identical in standalone and central mode.

#### Scenario: Large description file
- **GIVEN** an Experiment whose `experiment.json` is larger than 512 KiB
- **WHEN** a client requests the Experiment detail
- **THEN** the response is `200`, the Results section body is the digest, `documents.results.summary` is null and `summaryDeferred` reports the summary size
- **AND** the Results snapshot of the same Experiment is `200` with every Variant

#### Scenario: Oversized README section
- **GIVEN** an Experiment whose README Motivation section is longer than the raw section bound
- **WHEN** a client requests the Experiment detail
- **THEN** the response is `200`, the section text ends with the truncation notice, carries `SECTION_TRUNCATED`, and `README.md` is unchanged on disk

### Requirement: Run detail carries the Run's result rows

The Run detail response SHALL carry a nullable `result` describing the Run's `result.csv`: the project-relative file, the recorded `experiment_schema_version` (null when unreadable), the value rows in file order as `{key, stat, value, line}` with `stat` null for a scalar row and `value` the cell text exactly as written, a `truncated` flag when the file holds more rows than the response bound, and the file's parse diagnostics. Reserved rows SHALL NOT appear as value rows. A Run without a result file SHALL answer `result: null`. The field SHALL be identical in standalone and central mode and SHALL NOT carry an absolute path.

#### Scenario: Run detail with a result file
- **GIVEN** a Run whose `result.csv` records the version row and `metrics.eval.fid` `11.08` on line 3
- **WHEN** a client requests that Run's detail
- **THEN** `result.rows` contains `{key: "metrics.eval.fid", stat: null, value: "11.08", line: 3}`, `result.schemaVersion` is the recorded version and no row carries the reserved path

#### Scenario: Run detail without a result file
- **GIVEN** a Run directory without `result.csv`
- **WHEN** a client requests that Run's detail
- **THEN** the response carries `result: null`
