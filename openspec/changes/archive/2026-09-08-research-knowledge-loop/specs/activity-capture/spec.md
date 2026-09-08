## Purpose

Provide automatic, bounded records of non-readonly tool invocations and CLI-owned document maintenance submissions. Journal is a call ledger, not research knowledge or universal shell interception.

## ADDED Requirements

### Requirement: Native mutations record typed operation receipts automatically

Every supported non-readonly CLI or project service invocation SHALL record its own versioned entry containing an invocation ID, local-offset start/completion times, origin, operation, bounded safe parameters/targets and outcome. Failure, conflict, partial completion and no-op invocations SHALL remain visible. Helpers and SSE consumers SHALL NOT duplicate the parent call. Reads, polling, help, validation, lint and read-only dry runs SHALL NOT create activity. Separate retries SHALL have separate invocation identities without reapplying completed document maintenance.

#### Scenario: One logical operation changes several files
- **WHEN** a successful bind updates an Experiment and a Run
- **THEN** one successful receipt identifies both targets and both file changes

#### Scenario: Concurrent writers
- **WHEN** two independent supported mutations finish concurrently
- **THEN** each receipt remains discoverable and neither replaces the other

### Requirement: Direct-file finalization records observed changes without prose

After direct Experiment/Wiki document maintenance, an agent SHALL invoke `memon journal submit --files <relative-paths...>` once for the batch. The CLI SHALL validate allowed managed paths and symlink boundaries, inspect current files and compute their fingerprints, and generate the record itself. Agents SHALL NOT read, create, append, overwrite or otherwise manipulate Journal storage, even to finalize maintenance. The command SHALL NOT accept arbitrary Journal prose, scan payload trees, imply Git push, or fabricate unobserved preimages.

#### Scenario: Repeated maintenance submission
- **WHEN** the same document batch is submitted again without document changes
- **THEN** the second invocation remains visible without rewriting the research documents or claiming a second edit occurred

#### Scenario: Mutating invocation fails or does nothing
- **WHEN** a supported write invocation fails, conflicts or determines that no change is needed
- **THEN** its invocation and accurate outcome remain in the ledger

#### Scenario: Submission includes an unsafe path
- **WHEN** a batch includes a secret file, payload tree or symlink escape
- **THEN** submission rejects it without reading the external content or certifying the batch

### Requirement: Receipt failure cannot masquerade as complete success

A completed research document write SHALL NOT be rolled back solely because diagnostic recording fails. The caller SHALL receive an explicit recording failure or partial outcome, not silent complete success. Existing source-level concurrency and mutation rollback guarantees SHALL remain intact. Interrupted entries SHALL remain incomplete rather than fabricated successes.

#### Scenario: Receipt completion fails after a successful write
- **WHEN** the research write succeeds but completion recording fails
- **THEN** the research content remains saved and the caller receives an explicit diagnostic-recording failure

### Requirement: Activity is diagnostic metadata with bounded disclosure

Receipts SHALL omit source bodies, credentials, full environment dumps and absolute machine paths. Capture and merged receipt diagnostics SHALL require owner authority on services and preserve project/root safety. Legacy Journal data SHALL remain readable under its existing read scope without granting viewers access to new owner-only diagnostic receipts.

#### Scenario: Unauthorized diagnostic read
- **WHEN** a viewer requests operation receipts
- **THEN** the service denies access and does not leak changed paths or errors
