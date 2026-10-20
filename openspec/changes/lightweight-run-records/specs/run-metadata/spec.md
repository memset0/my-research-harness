## Purpose

Preserve execution facts as portable machine-maintained Run records without requiring an authored document or trusting filesystem creation times.

## ADDED Requirements

### Requirement: Lightweight Run metadata
A lightweight Run SHALL store `run.json` containing `id`, uppercase execution `status`, independent boolean `active`, and `created_at`. Optional fields SHALL capture `updated_at`, `started_at`, `finished_at`, name, execution host, process/GPU references, command, entry, W&B URL and scheduler job identity. New execution states SHALL distinguish `READY` (unsubmitted), `QUEUED` (submitted), `RUNNING`, `RESUME_READY` (continuation prepared, unsubmitted), `FINISHED`, `INTERRUPTED`, `FAILED` and `UNKNOWN`. Legacy `PENDING` SHALL remain readable as ambiguous without guessing. Optional `params` SHALL hold planned parameters before execution; metrics SHALL remain in result.csv. Optional names and assessments SHALL be supported without required prose. Active selection SHALL NOT imply execution success or measurement validity. New records SHALL NOT create README files.

#### Scenario: Queued execution survives checkout
- **WHEN** a queued Run with scheduler identity and creation time is read after Git synchronization
- **THEN** those facts are read from `run.json` independently of filesystem timestamps

### Requirement: Event timestamps are explicit and offset aware
Persisted Run timestamps SHALL be valid calendar date-times with numeric UTC offsets. Automatic timestamps SHALL use the writer process's local offset. Creation SHALL record the time the record is created unless an explicit historical timestamp is supplied; it SHALL NOT infer an execution timestamp from a directory name or mtime. A transition to running SHALL record an observed start time if none exists; a transition to terminal state SHALL record the observed finish time. Resume SHALL preserve creation/start time. Preparing resume SHALL retain the previous execution facts and measurements; entering RUNNING SHALL clear the previous finish time. Parameters associated with existing measurements SHALL NOT be relabeled by a resume preparation.

#### Scenario: Missing source timezone
- **WHEN** a new record is made for a directory with an old mtime and date-looking name
- **THEN** its default creation timestamp is the current record creation time, not either inferred time

#### Scenario: Invalid timestamp
- **WHEN** a caller supplies a timestamp without an offset or with an impossible calendar day
- **THEN** the write is rejected without modifying the record

### Requirement: Safe record creation and updates
Creation SHALL refuse to overwrite an existing Run record or legacy README. Updates SHALL preserve unspecified facts and require an optimistic mtime plus content hash check under the writer lock. CLI metadata updates SHALL allow recording scheduler and tracking references after submission without hand-editing a file. Supported CLI lifecycle writes SHALL refresh the Run and experiment CSVs before publishing the derived index. Run paths SHALL remain contained within the project.

#### Scenario: Stale write
- **WHEN** a Run record changes after a caller obtained its timestamp and hash
- **THEN** the stale update fails with conflict and preserves the newer file

### Requirement: Read compatibility
Readers SHALL prefer a present `run.json`, expose its execution facts through the shared Run representation, and continue reading legacy README-only Runs. Invalid JSON metadata SHALL produce diagnostics and SHALL NOT silently fall back to contradictory README facts. The derived index SHALL fingerprint the metadata file and retain its record identity.

#### Scenario: Lightweight Run without README
- **WHEN** a valid `run.json` exists without README
- **THEN** its status, timestamps and execution references remain available and no missing-README warning is emitted

### Requirement: Inactive evidence and imported prose retain their meaning
The active flag SHALL control current Variant participation independently of execution status. Optional structured assessments SHALL distinguish invalid measurement, limited accuracy and superseded method with a reason, without inferring any of them from inactivity or retirement. Explicitly invalid measurements SHALL NOT contribute current measured results. Migrated README bodies SHALL be importable as optional `legacy_sections` with their original headings and content. Deprecation of these compatibility sections SHALL NOT deprecate the measurement itself.

#### Scenario: Historical but useful measurement
- **WHEN** a FINISHED Run becomes inactive because a better measurement method is adopted
- **THEN** its status and original data remain readable together with the supersession reason, without a fabricated invalid-measurement judgment

#### Scenario: Imported README
- **WHEN** an old Run with narrative sections is explicitly migrated
- **THEN** retained sections can be read from structured deprecated-format fields without a Run README or a requirement to fill those sections on future Runs
