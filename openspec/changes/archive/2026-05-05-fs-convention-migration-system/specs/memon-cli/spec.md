## ADDED Requirements

### Requirement: `memon install-skills` writes and reports `.memon/version.json`

After completing the skill-directory synchronisation (and before the AGENTS.md-symlink step), `memon install-skills` SHALL inspect `<projectRoot>/.memon/version.json`:

- **If the file does not exist**: create `<projectRoot>/.memon/` if necessary and write a fresh marker with `fs_convention_version = FS_CONVENTION_VERSION`, `installed_at = <now>` (ISO8601 with timezone offset), `last_migrated_at = null`. This branch SHALL NOT be treated as an upgrade and SHALL NOT prompt the user — first install means no legacy state.
- **If the file exists with `fs_convention_version === FS_CONVENTION_VERSION`**: leave the file untouched. Report `fsVersion.status: "match"`.
- **If the file exists with `fs_convention_version < FS_CONVENTION_VERSION`**: leave the file untouched. Print a banner to stderr (interactive runs) describing the gap and recommending `memon-migrate-fs`. Report `fsVersion.status: "behind"` and `fsVersion.upgradeRequired: true`. **Do NOT migrate**.
- **If the file exists with `fs_convention_version > FS_CONVENTION_VERSION`**: refuse with exit code `MEMON_TOO_OLD`. Print to stderr that the project root expects a newer memon and the user should upgrade memon. Do not write the marker; do not run any further install steps.

The JSON output SHALL gain a top-level `fsVersion` block:

```jsonc
{
  // ... existing top-level fields ...
  "fsVersion": {
    "current": <integer>,             // what was on disk before the run (null if uninitialised)
    "available": <integer>,           // FS_CONVENTION_VERSION
    "status": "uninitialised" | "match" | "behind" | "ahead",
    "upgradeRequired": boolean,
    "writtenAt": "<ISO8601>" | null   // present iff this run wrote the marker
  }
}
```

The `--target` invocation (which decouples install from a project root) SHALL set `fsVersion: null` in JSON output and SHALL NOT touch any `.memon/version.json` (the user opted out of project-root-derived behaviour).

#### Scenario: First install creates marker
- **GIVEN** `<root>` has no `.memon/` directory
- **WHEN** `memon install-skills --project-root <root> --format json` runs and `FS_CONVENTION_VERSION === 1`
- **THEN** `<root>/.memon/version.json` exists with `fs_convention_version: 1`, `last_migrated_at: null`, and an `installed_at` timestamp matching the current time
- **AND** stdout JSON has `fsVersion: { current: null, available: 1, status: "uninitialised", upgradeRequired: false, writtenAt: "<ISO>" }`
- **AND** the run does NOT prompt the user about FS version

#### Scenario: Re-install on matching version is a no-op for the marker
- **GIVEN** `<root>/.memon/version.json` exists with `fs_convention_version: 2` and `installed_at: "2026-04-01T10:00:00+08:00"`
- **WHEN** `memon install-skills --project-root <root>` runs again with `FS_CONVENTION_VERSION === 2`
- **THEN** the file's bytes are unchanged (`installed_at` still `"2026-04-01T10:00:00+08:00"`, `last_migrated_at` unchanged)
- **AND** JSON output has `fsVersion.status === "match"` and `fsVersion.writtenAt === null`

#### Scenario: Behind version surfaces upgrade banner without writing
- **GIVEN** `<root>/.memon/version.json` has `fs_convention_version: 1` and `FS_CONVENTION_VERSION === 3`
- **WHEN** `memon install-skills --project-root <root>` runs (TTY)
- **THEN** stderr contains a banner naming v1 / v3 / `memon-migrate-fs`
- **AND** the file is unchanged
- **AND** JSON output has `fsVersion: { current: 1, available: 3, status: "behind", upgradeRequired: true, writtenAt: null }`
- **AND** the install command itself exits 0 (the skill copy succeeded; the upgrade is informational)

#### Scenario: Ahead version refuses with MEMON_TOO_OLD
- **GIVEN** `<root>/.memon/version.json` has `fs_convention_version: 5` and the running memon has `FS_CONVENTION_VERSION === 3`
- **WHEN** `memon install-skills --project-root <root>` runs
- **THEN** the command exits with code `MEMON_TOO_OLD`
- **AND** stderr names the gap and tells the user to upgrade memon
- **AND** the file is unchanged
- **AND** **NO skill files are written** for this run (the install is fully aborted, not just the marker step)

#### Scenario: --target opts out of marker handling
- **WHEN** `memon install-skills --target /opt/skills --format json` runs
- **THEN** stdout JSON has `fsVersion: null`
- **AND** no `.memon/` directory is created anywhere

### Requirement: `memon fs-version check` command surfaces the version state

`memon fs-version check --project-root <p> [--format json]` SHALL be a read-only command that reports the FS convention version state of `<p>`. It SHALL NOT write any file, NOT trigger migration, and NOT prompt the user.

The command SHALL read `<p>/.memon/version.json` (if present) and emit:

```jsonc
{
  "projectRoot": "<abs path>",
  "current": <integer> | null,        // null if .memon/version.json is absent
  "available": <integer>,             // FS_CONVENTION_VERSION
  "status": "uninitialised" | "match" | "behind" | "ahead"
}
```

Exit codes:
- `0` for `status: "match"`, `"uninitialised"`, or `"behind"` — the state is observable and reportable.
- `MEMON_TOO_OLD` for `status: "ahead"` — the tool cannot safely operate on this project root.

The command SHALL be safe to call from skill preflight without side effects.

#### Scenario: Match returns 0 with status match
- **GIVEN** `<root>/.memon/version.json` has `fs_convention_version === FS_CONVENTION_VERSION === 2`
- **WHEN** `memon fs-version check --project-root <root> --format json` runs
- **THEN** exit code is 0
- **AND** stdout JSON has `status: "match"`, `current: 2`, `available: 2`

#### Scenario: Uninitialised returns 0 with status uninitialised
- **GIVEN** `<root>` has no `.memon/version.json`
- **WHEN** `memon fs-version check --project-root <root> --format json` runs
- **THEN** exit code is 0
- **AND** stdout JSON has `status: "uninitialised"`, `current: null`, `available: <FS_CONVENTION_VERSION>`

#### Scenario: Behind returns 0 with status behind
- **GIVEN** `<root>/.memon/version.json` has `fs_convention_version: 1`, `FS_CONVENTION_VERSION === 3`
- **WHEN** the check runs
- **THEN** exit code is 0
- **AND** stdout JSON has `status: "behind"`, `current: 1`, `available: 3`

#### Scenario: Ahead exits MEMON_TOO_OLD
- **GIVEN** `<root>/.memon/version.json` has `fs_convention_version: 5`, `FS_CONVENTION_VERSION === 3`
- **WHEN** the check runs
- **THEN** exit code is `MEMON_TOO_OLD` (per the modified exit-code dictionary)
- **AND** stdout JSON still has the full status block (so callers can parse it before checking exit code)

#### Scenario: Read-only — no file writes
- **GIVEN** any state of `<root>/.memon/`
- **WHEN** `memon fs-version check --project-root <root>` runs
- **THEN** the mtime of every file under `<root>/.memon/` is unchanged
- **AND** no new files are created under `<root>/.memon/`

## MODIFIED Requirements

### Requirement: Stable exit-code dictionary

The CLI SHALL use this exit code table for all subcommands. Skills depend on these for branch logic.

| code | semantic |
|---|---|
| 0 | success |
| 1 | generic / unclassified failure |
| 2 | usage / flag error (commander default) |
| 4 | NOT_FOUND (resource doesn't exist) |
| 9 | CONFLICT (mtime / hash lock failure — skill should refresh and retry) |
| 11 | MEMON_TOO_OLD (project's `fs_convention_version` exceeds `FS_CONVENTION_VERSION`; user must upgrade memon) |
| 13 | FORBIDDEN (path safety / permission) |

#### Scenario: Skill retries on exit 9
- **WHEN** any write command exits with code 9
- **THEN** the stderr JSON has `error.code === "CONFLICT"` and stdout/stderr include enough state for the caller to retry without losing intent (current mtime + current content for README writes; current frontmatter for digest-mark)

#### Scenario: Forward-incompatible project root exits 11
- **GIVEN** `<root>/.memon/version.json` has `fs_convention_version: 5` and the running memon has `FS_CONVENTION_VERSION === 3`
- **WHEN** any command that preflights FS version runs against `<root>` (`memon install-skills`, `memon fs-version check`, or any preflight-checking skill invocation)
- **THEN** the command exits with code 11
- **AND** the stderr JSON has `error.code === "MEMON_TOO_OLD"`
- **AND** the message names both the project's version and the tool's version
