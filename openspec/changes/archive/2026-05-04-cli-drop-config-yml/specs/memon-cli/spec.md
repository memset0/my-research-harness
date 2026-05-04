## MODIFIED Requirements

### Requirement: `memon serve` starts the web frontend + backend

`memon serve` SHALL start the Next.js production server (or dev server when invoked with `--dev`). The server reads the resolved `config.yml` and exposes the web UI at the configured host/port (default `localhost:3737`).

`--config <path>` is a **serve-specific** option (not a global). It SHALL only be accepted when attached to the `serve` subcommand; passing it as a global option (e.g. `memon --config X serve`) SHALL be rejected by the command parser.

#### Scenario: Default serve
- **WHEN** the user runs `memon serve` in a directory containing `config.yml`
- **THEN** the server starts, prints the URL, watches no fs (uses polling per the discovery spec), and serves the dashboard

#### Scenario: Explicit config
- **WHEN** the user runs `memon serve --config /absolute/path/config.yml`
- **THEN** the server uses that config file regardless of cwd

#### Scenario: --config on a non-serve subcommand is rejected
- **WHEN** the user runs `memon list --config /tmp/config.yml`
- **THEN** the command parser rejects the unknown option with a non-zero exit (commander's standard "unknown option" error)
- **AND** no configuration file is read

### Requirement: Config resolution order

For all **non-`serve`** subcommands, the system SHALL resolve the project context in this order:
1. **`--project-root <path>`** (when present, treats the path as a single anonymous project)
2. **Implicit cwd** — when `--project-root` is absent, `process.cwd()` is treated as a single anonymous project's root

There SHALL be no `<cwd>/config.yml` lookup and no `--config <path>` flag for non-`serve` subcommands. `loadCliContext` in `@memon/core` SHALL accept only `projectRoot` and `cwd` in its input; its `source` field SHALL be one of `'project-root' | 'implicit-cwd'`.

For `memon serve`, configuration resolution is handled within the `serve` subcommand itself (see "memon serve" requirement above) and SHALL look at the explicit `--config <path>`, then `<cwd>/config.yml`, then `<repo-root>/config.yml`.

`--project-root` is mutually exclusive with `--project NAME`; combining them SHALL exit 2 with a `BAD_REQUEST` error. (`--config` is no longer a global flag, so the historical `--project-root` × `--config` mutual exclusion no longer applies at the global level.)

#### Scenario: --project-root takes precedence
- **WHEN** the user runs `memon list --project-root /a` from a directory that also contains a `config.yml`
- **THEN** `/a` is used as the project root and the cwd `config.yml` is NOT read (the CLI does not look at it)

#### Scenario: Implicit cwd-as-project for `list`
- **WHEN** the user runs `memon list` with no `--project-root` from inside `/some/project-dir`
- **THEN** the command treats `/some/project-dir` as the single anonymous project's root and proceeds; no `config.yml` lookup happens

#### Scenario: `serve` without any config
- **WHEN** the user runs `memon serve` without `--config` and no `config.yml` in cwd or repo root
- **THEN** the command exits with a structured error explaining how to create `config.yml`. (Note: `memon serve` does NOT support `--project-root` since the web stack requires the full config schema for multi-project setups.)

### Requirement: `--project-root` flag bypasses config.yml entirely

All read subcommands (`list` / `show` / `search` / `hypo list` / `hypo show` / `scan`) AND the write subcommands SHALL accept a `--project-root <path>` flag. When given, the command SHALL treat that path as a single anonymous project's root and SHALL NOT attempt to read any `config.yml` from any location. `--project-root` SHALL be mutually exclusive with `--project NAME`; using both SHALL exit with code 2 and a `BAD_REQUEST` error.

#### Scenario: `--project-root` works without any config file present
- **WHEN** the user runs `memon list --project-root /tmp/some/project` on a host with no `config.yml` anywhere
- **THEN** the command treats `/tmp/some/project` as the project root, scans it, and outputs the experiment list as JSON; exit 0

#### Scenario: Mutual exclusion with --project NAME
- **WHEN** the user runs `memon list --project-root /a --project foo`
- **THEN** the command exits 2 with stderr `{"error":{"code":"BAD_REQUEST","message":"--project-root cannot be combined with --project"}}`

#### Scenario: Path doesn't exist
- **WHEN** the user runs `memon list --project-root /does/not/exist`
- **THEN** the command exits 4 with stderr `{"error":{"code":"NOT_FOUND","message":"project root does not exist: ..."}}`
