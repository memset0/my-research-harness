## ADDED Requirements

### Requirement: CLI help text reflects the post-v5 on-disk layout

The `memon experiment` parent command and the `memon experiment create` subcommand SHALL render `.description(…)` help text that names the post-v5 on-disk path for exp docs (`docs/experiments/E<NNNN>-<slug>/README.md`), NOT the legacy v4 file form (`docs/experiments/E<NNNN>-<slug>.md`). This requirement covers user-facing strings reachable via `memon --help` / `memon experiment --help` / `memon experiment create --help`. Internal source-code comments in the same files SHALL also be brought into v5-correct form so contributors are not misled about the on-disk layout.

The CLI SHALL detect "first argument is an experiment id" via `EXPERIMENT_DIR_REGEX.test(id)` (the v5 canonical regex) at every CLI dispatch site under `memon experiment <subcommand> <id>`. The earlier workaround — appending `.md` to the id and matching `EXPERIMENT_FILENAME_REGEX` — SHALL be replaced because it propagates v4 framing into v5 code paths and reads as if the CLI expects file-form ids.

This requirement carries NO behavior change observable from inside the runtime (regex-detection result is identical for valid ids; serialized JSON output is unchanged). It is solely a help-text and code-readability contract that ensures the CLI surface reflects the current on-disk layout.

#### Scenario: `memon experiment --help` mentions the v5 folder/README path
- **WHEN** the user runs `memon experiment --help`
- **THEN** the printed description for the `experiment` parent command contains `docs/experiments/E<NNNN>-<slug>/README.md`
- **AND** the printed description does NOT contain the bare `docs/experiments/E<NNNN>-<slug>.md` string

#### Scenario: `memon experiment create --help` mentions the v5 folder/README path
- **WHEN** the user runs `memon experiment create --help`
- **THEN** the printed description for `experiment create` contains `docs/experiments/E<NNNN>-<slug>/README.md`
- **AND** the printed description does NOT mention `docs/experiments/E<NNNN>-<slug>.md`

#### Scenario: exp-id detection at dispatch sites uses EXPERIMENT_DIR_REGEX
- **WHEN** a developer audits `packages/cli/src/index.ts` for the idiom `\`${id}.md\`.match(EXPERIMENT_FILENAME_REGEX)`
- **THEN** zero matches are found
- **AND** every former call site uses `EXPERIMENT_DIR_REGEX.test(id)` instead

#### Scenario: error message names the correct regex
- **GIVEN** a user runs `memon experiment status set malformed-id --to FINISHED`
- **WHEN** `malformed-id` matches neither the experiment-id nor the run-dir shape
- **THEN** the error message references `EXPERIMENT_DIR_REGEX (E<NNNN>-<slug>)` as the expected exp-id pattern
- **AND** the error message does NOT reference `EXPERIMENT_FILENAME_REGEX`
