## ADDED Requirements

### Requirement: Structured Experiment document commands are read and check surfaces

The CLI SHALL expose `memon experiment doc show <id> <section>`, `render <id> <section>`, `validate <id>`, and `lint <id>` for v6 Experiment bundles. `section` SHALL be one of `implementation`, `investigation`, or `results`. Human show/render output SHALL use Core's deterministic Markdown projection; JSON output SHALL include structured diagnostics. Validate and lint SHALL exit non-zero when any error diagnostic exists.

The CLI SHALL NOT expose item-level create, update, delete, reorder, or status-mutation commands for the YAML trees or Variants. Agents edit the YAML source files directly.

#### Scenario: Managed section renders for a human
- **WHEN** the user runs `memon --project-root . --format human experiment doc render E0001-example results`
- **THEN** stdout contains the Core-generated human-readable Results Markdown
- **AND** no source file is modified

#### Scenario: Strict lint preserves incompatible content
- **GIVEN** an Experiment README has an unsupported `## Plan` body
- **WHEN** `memon --project-root . --format json experiment doc lint E0001-example` runs
- **THEN** it exits non-zero with an `UNKNOWN_H2_SECTION` error
- **AND** the README remains byte-unchanged and readable

### Requirement: Warning compatibility commands remain permanently deprecated

All existing `memon experiment warning ...` commands and `memon run warning add ...` SHALL remain functional indefinitely. Each CLI invocation SHALL print exactly one permanent `[deprecated]` line to stderr directing agents to `memon-write-experiment-doc`. This warning-specific notice SHALL NOT declare a removal release and SHALL NOT be suppressed by `MEMON_QUIET_DEPRECATIONS`.

#### Scenario: Warning command emits one permanent notice
- **WHEN** the user invokes any retained warning command with `MEMON_QUIET_DEPRECATIONS=1`
- **THEN** stderr still contains exactly one `[deprecated]` notice
- **AND** the compatibility operation executes normally
