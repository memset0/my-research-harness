# memon-cli Specification

## Purpose
TBD - created by archiving change add-memon-mvp. Update Purpose after archive.
## Requirements
### Requirement: Single binary `memon` with subcommands

The package SHALL expose a single CLI binary `memon` (registered via `package.json` `bin`) with subcommands: `serve`, `list`, `show`, `search`, `new`, `hypo`, `mock`. Running `memon` with no arguments SHALL print top-level help.

#### Scenario: Help on no args
- **WHEN** the user runs `memon` with no arguments
- **THEN** stdout shows the usage block listing all subcommands and their one-line descriptions, exit code 0

#### Scenario: Unknown subcommand
- **WHEN** the user runs `memon nonexistent`
- **THEN** stderr shows an "unknown command" message, suggests close matches if any, exit code 2

### Requirement: `memon serve` starts the web frontend + backend

`memon serve` SHALL start the Next.js production server (or dev server when invoked with `--dev`). The server reads the resolved `config.yml` and exposes the web UI at the configured host/port (default `localhost:3737`).

#### Scenario: Default serve
- **WHEN** the user runs `memon serve` in a directory containing `config.yml`
- **THEN** the server starts, prints the URL, watches no fs (uses polling per the discovery spec), and serves the dashboard

#### Scenario: Explicit config
- **WHEN** the user runs `memon serve --config /absolute/path/config.yml`
- **THEN** the server uses that config file regardless of cwd

### Requirement: Config resolution order

For all subcommands, the system SHALL resolve configuration in this order:
1. Explicit `--config <path>` argument
2. `<cwd>/config.yml`
3. For non-`serve` subcommands only: implicit single-project mode using cwd as that project's root

If the resolved config exists but does not parse, the command SHALL exit with a structured error and code 1.

#### Scenario: --config wins over cwd config
- **WHEN** both `<cwd>/config.yml` and `--config /tmp/other.yml` are provided
- **THEN** `/tmp/other.yml` is used and the cwd config is ignored

#### Scenario: Implicit cwd-as-project for `list`
- **WHEN** the user runs `memon list` in a directory without `config.yml` and without `--config`
- **THEN** the command treats cwd as a single anonymous project's root and proceeds

#### Scenario: `serve` without any config
- **WHEN** the user runs `memon serve` without `--config` and no `config.yml` in cwd
- **THEN** the command exits with a structured error explaining how to create `config.yml`

### Requirement: Default JSON output, `--format human` for human

All read subcommands (`list`, `show`, `search`, `hypo list`, `hypo show`) SHALL default to machine-readable JSON output on stdout to support agent consumption. A `--format human` flag SHALL switch to a tabular/colored human-readable rendering.

#### Scenario: JSON list output
- **WHEN** the user runs `memon list`
- **THEN** stdout is valid JSON: `{"experiments": [...]}` with all parsed front-matter fields

#### Scenario: Human list output
- **WHEN** the user runs `memon list --format human`
- **THEN** stdout is a table with columns `id | status emoji | name | created_at | hypotheses`

### Requirement: `memon list` with optional project filter

`memon list` SHALL output all experiments across all configured projects, optionally filtered by `--project <name>`. The output is sorted by `created_at` descending.

#### Scenario: Filter by project
- **WHEN** the user runs `memon list --project fsdp-comm`
- **THEN** only experiments whose `project` field is `fsdp-comm` are returned

### Requirement: `memon show <id>`

`memon show <id>` SHALL output the full content of the named experiment's `README.md`. By default the output is the raw markdown text; `--format json` returns `{frontMatter, body, sections}` where `sections` is a parsed structure keyed by section heading.

#### Scenario: Show by exact id
- **WHEN** the user runs `memon show foo-260503-082800`
- **THEN** stdout is the raw `README.md` content if it exists, or a structured "not found" error JSON otherwise

### Requirement: `memon search <query>`

`memon search <query>` SHALL perform substring search across experiments' `README.md` content. Default scope is body + front matter; `--in body` or `--in fm` narrows scope. Output (default JSON) lists matching experiments with snippet excerpts around each match.

#### Scenario: Body-only search
- **WHEN** the user runs `memon search "loss diverged" --in body`
- **THEN** stdout lists only experiments whose body text (excluding front matter) contains "loss diverged", each with a snippet of context

### Requirement: `memon new <name>` creates an experiment scaffold

`memon new <name>` SHALL create a new experiment directory at `<project_root>/logs/<name>-<yymmdd>-<hhmmss>/` (using current local time) with:
- a `README.md` populated by a template (front matter prefilled, sections empty)
- an executable `run.sh` template (referenced as `entry`)
- an entry appended to the project's `JOURNAL.md` with tag `[CREATE]`

#### Scenario: Successful creation
- **WHEN** the user runs `memon new attn-overlap` in a project with root `/mnt/p`
- **THEN** the directory `/mnt/p/logs/attn-overlap-260503-100000/` is created (timestamp = local now), `README.md` and `run.sh` are written, and a `[CREATE]` event is appended to `/mnt/p/JOURNAL.md`

#### Scenario: Name collision in same second
- **WHEN** the user runs `memon new attn-overlap` and a directory with the resulting timestamp already exists
- **THEN** the command exits with a clear collision error and does not overwrite

### Requirement: `memon hypo` subcommands

`memon hypo` SHALL be a parent command with at least:
- `memon hypo list` — list all hypotheses across configured projects (or filtered by `--project`)
- `memon hypo show <H#>` — output a single hypothesis entry

#### Scenario: List
- **WHEN** the user runs `memon hypo list --project fsdp-comm`
- **THEN** stdout is JSON with the hypothesis records for that project

#### Scenario: Show
- **WHEN** the user runs `memon hypo show H3 --project fsdp-comm`
- **THEN** stdout is JSON with the parsed hypothesis record (statement, status, experiments, evidence, etc.)

### Requirement: `memon mock seed` resets dev mock data

`memon mock seed` SHALL copy the contents of the in-repo `mock/` directory to a writable dev location (`./mock-runtime/` or similar, configurable) so users can experiment without polluting the git-tracked fixtures. Re-running `seed` SHALL fully overwrite the runtime location.

#### Scenario: First seed
- **WHEN** the user runs `memon mock seed` in the repo root
- **THEN** `mock/` is copied recursively into the runtime location and a status message names the destination

#### Scenario: Re-seed overwrites
- **WHEN** the user runs `memon mock seed` after the runtime location already contains user-modified files
- **THEN** the command requires `--force` to proceed; without `--force` it exits with an explanatory error

