## MODIFIED Requirements

### Requirement: Two detection points for version mismatch

A project root's FS convention version SHALL be checked against `FS_CONVENTION_VERSION` at exactly two points:

1. **At `memon install-skills` time.** Whenever the command runs, after writing the skill files, it SHALL read `.memon/version.json` (creating it on first install per `fs-version-tracking`), compare to `FS_CONVENTION_VERSION`, and surface mismatch in the output.
2. **At skill preflight time.** Every memon skill that reads or writes a spec file (the project root's `README.md`, `HYPOTHESES.md`, `JOURNAL.md`, or anything under `<projectRoot>/docs/reports/` or `<projectRoot>/docs/wiki/`) SHALL invoke `memon fs-version check --project-root <p>` as the first executable step in its workflow body and branch on the result.

Pure read-only memon CLI commands (e.g., `memon show`, `memon hypotheses read`) SHALL NOT preflight-check, to avoid adding latency to non-mutating operations. Skills that only invoke read-only CLI commands and never write a spec file are also exempt; in practice all current skills mutate spec files, so all of them preflight.

#### Scenario: install-skills reports match
- **GIVEN** `<root>/.memon/version.json` has `fs_convention_version: <FS_CONVENTION_VERSION>`
- **WHEN** `memon install-skills --project-root <root> --format json` runs
- **THEN** the JSON output includes `fsVersion: { current: <V>, available: <V>, status: "match", upgradeRequired: false }`

#### Scenario: install-skills reports behind
- **GIVEN** `<root>/.memon/version.json` has `fs_convention_version: 1` and `FS_CONVENTION_VERSION === 3`
- **WHEN** `memon install-skills --project-root <root>` runs
- **THEN** stderr includes a banner: `WARNING: Project FS convention is at v1; current memon expects v3. Run the migrate-fs skill to upgrade.`
- **AND** JSON output includes `fsVersion: { current: 1, available: 3, status: "behind", upgradeRequired: true }`
- **AND** `<root>/.memon/version.json` is left UNCHANGED (install does not migrate)

#### Scenario: Skill preflight on match
- **GIVEN** `<root>/.memon/version.json` has `fs_convention_version: <FS_CONVENTION_VERSION>`
- **WHEN** any memon-* skill runs against `<root>` and executes its preflight
- **THEN** `memon fs-version check --project-root <root> --format json` reports `status: "match"`
- **AND** the skill proceeds to its main workflow

#### Scenario: Skill preflight on behind blocks workflow
- **GIVEN** `<root>/.memon/version.json` has `fs_convention_version: 1` and the running memon has `FS_CONVENTION_VERSION === 2`
- **WHEN** any memon-* skill runs against `<root>` and executes its preflight
- **THEN** `memon fs-version check` reports `status: "behind"`
- **AND** the skill SHALL NOT proceed to its main workflow
- **AND** the skill SHALL surface the gap to the user and recommend invoking `memon-migrate-fs`

#### Scenario: Read-only commands skip preflight
- **WHEN** `memon show <id> --project-root <root>` runs
- **THEN** the command does NOT call `memon fs-version check`
- **AND** the command runs normally regardless of `.memon/version.json` state
