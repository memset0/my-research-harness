## ADDED Requirements

### Requirement: Every bundled skill reports encountered CLI problems at terminal handoff

Every skill exported in `SKILL_NAMES` SHALL follow the shared CLI-issue reporting protocol. A suspected memon CLI problem includes a crash, unexpected non-zero exit, rejection of valid input, malformed or internally inconsistent output, documented/output behavior mismatch, or a workaround required because the intended CLI path did not work.

When a safe workaround exists, the skill SHALL continue the user's requested task and defer the CLI issue report until its final successful handoff. When the issue prevents completion, the skill SHALL include the report in its blocked handoff. The report SHALL contain the redacted command or operation, observed behavior, expected behavior, task impact and workaround, and whether the issue was reproduced. It SHALL NOT expose credentials or other secrets.

Expected domain-state and validation failures SHALL NOT automatically be labeled CLI bugs. Examples include a documented preflight version mismatch, a genuinely missing ID, invalid user input, or lint correctly rejecting an invalid document. When classification is uncertain, the skill SHALL describe the evidence and uncertainty instead of asserting a bug.

#### Scenario: Workaround succeeds and report is deferred
- **GIVEN** a memon CLI operation produces malformed output during a skill workflow
- **AND** the Agent safely completes the requested task through a direct-file or equivalent supported workaround
- **WHEN** the skill returns its final handoff
- **THEN** it reports the CLI operation, observed versus expected behavior, workaround, and reproducibility
- **AND** it does not interrupt the task solely to report the non-blocking issue

#### Scenario: CLI issue blocks completion
- **GIVEN** a suspected CLI problem has no safe in-scope workaround
- **WHEN** the skill returns a blocked handoff
- **THEN** the handoff includes the redacted diagnostic evidence and task impact

#### Scenario: Expected validation failure is not mislabeled
- **GIVEN** `memon experiment doc lint` correctly rejects an invalid Experiment bundle
- **WHEN** the skill reports its outcome
- **THEN** it describes the document diagnostic as project state to fix
- **AND** it does not claim the CLI itself is buggy without contradictory evidence
