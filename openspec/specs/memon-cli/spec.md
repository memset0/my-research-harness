# memon-cli Specification

## Purpose
Define the native memon command surface, structured output, project-root selection and safe file mutations independently of central availability.

## Requirements

### Requirement: Single binary `memon` with subcommands

The package SHALL expose a single CLI binary `memon` (registered via
`package.json` `bin`) with subcommands: `serve`, `list`, `show`,
`search`, `hypo`, `mock`, `experiment`, `run`, `update`, `share`,
`scan`, `journal`, `hypotheses`, `wiki`, `install-skills`, `fs-version`.
Running `memon` with no arguments SHALL print top-level help.

The `experiment` and `run` subcommand families are described in the
ADDED requirements above. The legacy `memon experiment <cmd-that-was-
about-runs>` invocations (e.g. `memon experiment status set`, `memon
experiment readme write`, `memon experiment archive`, `memon
experiment unarchive`, `memon experiment warning *`) SHALL print a
deprecation message to stderr and dispatch to the equivalent `memon
run <cmd>` (or `memon experiment warning *` for the warnings family,
which keeps the same name but operates on the new exp doc layer in
v3). The deprecation message SHALL name the new command so users can
update scripts.

The deprecation banner SHALL be a single line beginning with the
literal token `[deprecation]`, printed to **stderr** so JSON consumers
on stdout aren't polluted. Scripted callers MAY suppress the banner
by setting the environment variable `MEMON_QUIET_DEPRECATIONS=1`
(any non-empty value), in which case the banner is omitted but the
command still dispatches as normal.

#### Scenario: Help on no args
- **WHEN** the user runs `memon` with no arguments
- **THEN** stdout shows the usage block listing all subcommands
  including `experiment`, `run`, and `wiki`, exit code 0

#### Scenario: Legacy `experiment status set` redirects to `run status set`
- **WHEN** the user runs `memon experiment status set foo-260501-100000
  --to FINISHED --expected-mtime <m>`
- **THEN** stderr contains a deprecation message naming
  `memon run status set`, AND the command dispatches to that path with
  the same arguments and exits 0 on success

#### Scenario: Deprecation banner format
- **WHEN** the user runs any v2-alias command (e.g.
  `memon experiment archive <id>`)
- **THEN** stderr contains exactly one line starting with
  `[deprecation]` and naming both the legacy command and its v3
  replacement; stdout is unchanged from the v3 command's output

#### Scenario: MEMON_QUIET_DEPRECATIONS suppresses the banner
- **GIVEN** `MEMON_QUIET_DEPRECATIONS=1` is set in the environment
- **WHEN** the user runs `memon experiment status set …`
- **THEN** stderr contains no `[deprecation]` line; the command
  still dispatches to `memon run status set` and exits 0

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

### Requirement: Legacy Telegram configuration is ignored with a warning

The configuration loader SHALL continue accepting a top-level `telegram:` key
so an otherwise valid legacy `config.yml` remains usable after notification
support is removed. Whenever that key is present, regardless of the shape or
completeness of its value, the loader SHALL ignore it, SHALL omit it from the
loaded configuration model, and SHALL emit a warning to stderr asking the
operator to remove the block and its stored credentials.

The warning MUST NOT print the legacy `bot_token`, `chat_id`, or any other value
from the block. Presence of the legacy key MUST NOT cause a non-zero exit or
prevent `serve` and other configuration consumers from starting.

#### Scenario: Complete legacy block warns and loads

- **GIVEN** an otherwise valid `config.yml` contains a complete `telegram:`
  block with a bot token and chat id
- **WHEN** the configuration is loaded
- **THEN** loading succeeds and stderr warns that Telegram support was removed
  and the credentials should be deleted
- **AND** the returned configuration has no Telegram field
- **AND** stderr contains neither the bot token nor chat id

#### Scenario: Malformed legacy block remains non-blocking

- **GIVEN** an otherwise valid `config.yml` contains `telegram:` with a value
  that did not satisfy the former Telegram schema
- **WHEN** the configuration is loaded
- **THEN** loading succeeds with the same removal warning
- **AND** the legacy value is ignored rather than validated

#### Scenario: Configuration without legacy key is quiet

- **GIVEN** a valid `config.yml` has no top-level `telegram:` key
- **WHEN** the configuration is loaded
- **THEN** no Telegram-removal warning is emitted

### Requirement: Config resolution order

For all **non-`serve`** subcommands, the system SHALL resolve the project context
in this order:

1. **`--project-root <path>`** (when present, treats the path as a single
   anonymous project)
2. **Implicit cwd** — when `--project-root` is absent, `process.cwd()` is treated
   as a single anonymous project's root

There SHALL be no `<cwd>/config.yml` lookup and no `--config <path>` flag for
these subcommands. `loadCliContext` in `@memon/core` SHALL accept only
`projectRoot` and `cwd` in its input; its `source` field SHALL be one of
`'project-root' | 'implicit-cwd'`.

For `memon serve`, configuration resolution is handled within the `serve`
subcommand itself (see "memon serve" requirement above) and SHALL look at the
explicit `--config <path>`, then `<cwd>/config.yml`, then
`<repo-root>/config.yml`.

`--project-root` is mutually exclusive with `--project NAME`; combining them
SHALL exit 2 with a `BAD_REQUEST` error. `--config` is not a global flag and is
valid only on `serve`.

#### Scenario: --project-root takes precedence

- **WHEN** the user runs `memon list --project-root /a` from a directory that
  also contains a `config.yml`
- **THEN** `/a` is used as the project root and the cwd `config.yml` is NOT read

#### Scenario: Implicit cwd-as-project for `list`

- **WHEN** the user runs `memon list` with no `--project-root` from inside
  `/some/project-dir`
- **THEN** the command treats `/some/project-dir` as the single anonymous
  project's root and proceeds; no `config.yml` lookup happens

#### Scenario: `serve` without any config

- **WHEN** the user runs `memon serve` without `--config` and no `config.yml` in
  cwd or repo root
- **THEN** the command exits with a structured error explaining how to create
  `config.yml`

### Requirement: Default JSON output, `--format human` for human

All read subcommands (`list`, `show`, `search`, `hypo list`, `hypo show`, **`scan`**, **`hypotheses read`**, **`journal read`**) SHALL default to machine-readable JSON output on stdout to support agent consumption. A `--format human` flag SHALL switch to a tabular/colored human-readable rendering.

Write subcommands (`experiment status set`, `experiment readme write`, `run record`, `journal submit`) SHALL emit JSON status objects on stdout (`{"ok":true,...}` on success, structured error JSON on failure). They SHALL NOT have a `--format human` mode in v1; their output is intended for skill consumption.

#### Scenario: JSON list output
- **WHEN** the user runs `memon list`
- **THEN** stdout is valid JSON: `{"experiments": [...]}` with all parsed front-matter fields

#### Scenario: Human list output
- **WHEN** the user runs `memon list --format human`
- **THEN** stdout is a table with columns `id | status emoji | name | created_at | hypotheses`

#### Scenario: Write command JSON output
- **WHEN** any write subcommand succeeds
- **THEN** stdout is `{"ok":true, ...command-specific fields...}`; the command SHALL NOT print human-readable lines on stdout

### Requirement: `memon list` with optional project filter

`memon list` SHALL output all **runs** across all configured projects,
optionally filtered by `--project <name>`. The filter SHALL match
against the run's top-level `project` field (set by discovery from the
matching `config.yml` project's `name`). The filter SHALL NOT consult
any frontmatter `project:` field (that field is gone in v3).

For listing experiments, users SHALL use `memon experiment ls`.

#### Scenario: Filter by membership project (config-derived)
- **WHEN** the user runs `memon list --project sparse-fsdp` with
  `config.yml` declaring a project `sparse-fsdp` whose root contains 71
  run dirs
- **THEN** all 71 runs are returned

#### Scenario: Sub-project search no longer applies
- **GIVEN** a v2-era run README that still has `project:
  predictive-skip-validation` in its frontmatter
- **WHEN** the user runs `memon search predictive-skip-validation`
- **THEN** the run is NOT surfaced via that label (sub-project search
  is removed in v3); the user is steered toward `tags` on the parent
  experiment doc as the v3 grouping mechanism

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

### Requirement: `memon hypo` subcommands

`memon hypo` SHALL be a parent command with at least:
- `memon hypo list` — list all hypotheses across configured projects (or filtered by `--project`)
- `memon hypo show <id>` — output a single hypothesis entry. The `<id>` argument SHALL strictly match `^H\d{4}$` (canonical 4-digit zero-padded form). Unpadded input (`H3`, `H03`) SHALL produce a `BAD_REQUEST` error and exit code 2.

#### Scenario: List
- **WHEN** the user runs `memon hypo list --project fsdp-comm`
- **THEN** stdout is JSON with the hypothesis records for that project, every record's `id` field in canonical padded form

#### Scenario: Show with padded id
- **WHEN** the user runs `memon hypo show H0003 --project fsdp-comm`
- **THEN** stdout is JSON with the parsed hypothesis record (statement, status, experiments, evidence, etc.) and `id: "H0003"`

#### Scenario: Show with unpadded id rejected
- **WHEN** the user runs `memon hypo show H3 --project fsdp-comm`
- **THEN** the command exits with code 2 and stderr names `BAD_REQUEST` plus a hint that the canonical form is `H0003`

### Requirement: `memon mock seed` resets dev mock data

`memon mock seed` SHALL copy the contents of the in-repo `mock/` directory to a writable dev location (`./mock-runtime/` or similar, configurable) so users can experiment without polluting the git-tracked fixtures. Re-running `seed` SHALL fully overwrite the runtime location.

#### Scenario: First seed
- **WHEN** the user runs `memon mock seed` in the repo root
- **THEN** `mock/` is copied recursively into the runtime location and a status message names the destination

#### Scenario: Re-seed overwrites
- **WHEN** the user runs `memon mock seed` after the runtime location already contains user-modified files
- **THEN** the command requires `--force` to proceed; without `--force` it exits with an explanatory error

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

### Requirement: `memon experiment status set` writes README + appends [STATUS] atomically

`memon experiment status set <id> --project-root <path> --to <STATUS> --expected-mtime <ms>` SHALL operate in two modes depending on the form of `<id>`:

**Run-id form (legacy / v2-compatible)**: when `<id>` matches `RUN_DIR_REGEX` (`^.+-\d{6}-\d{6}$`), the command SHALL be a deprecation alias for `memon run status set <id>` and SHALL emit a one-line `[deprecation]` banner to stderr (suppressible via `MEMON_QUIET_DEPRECATIONS=1`). The accepted `<STATUS>` values in this mode are the run-side enum (`PENDING` / `RUNNING` / `FINISHED` / `INTERRUPTED` / `FAILED` / `UNKNOWN`).

**Exp-id form (v3+)**: when `<id>` matches `EXPERIMENT_FILENAME_REGEX` (`^E\d{4}-[a-z0-9-]+$`), the command operates on `docs/experiments/<id>.md` per the new requirement under `experiment-edit`'s "memon experiment status set writes status + appends [EXP_STATUS] atomically." The accepted `<STATUS>` values in this mode are the `ExperimentStatus` enum (`OPEN` / `RESOLVED` / `ABANDONED`).

In both modes, the command SHALL apply the soft warning per `archive-frontmatter` when the target is `archived: true`. In run-id mode, the command SHALL apply the hard `archive-on-RUNNING` rule per `archive-frontmatter` when the new state would result in `archived: true, status: RUNNING`.

#### Scenario: Run-id form is a deprecation alias
- **WHEN** the user runs `memon experiment status set foo-260513-100000 --project-root <p> --to FINISHED --expected-mtime <m>`
- **THEN** stderr contains `[deprecation]` banner pointing to `memon run status set`
- **AND** the command dispatches to `memon run status set` and exits 0

#### Scenario: Exp-id form sets ExperimentStatus
- **WHEN** the user runs `memon experiment status set E0001-foo --project-root <p> --to RESOLVED --expected-mtime <m>`
- **THEN** the doc's frontmatter has `status: RESOLVED`
- **AND** the automatic invocation includes a `[EXP_STATUS] OPEN → RESOLVED` line
- **AND** stdout `{"ok":true,"mtime":<n>,"prevStatus":"OPEN","nextStatus":"RESOLVED"}`

#### Scenario: Exp-id form rejects run-side enum value
- **WHEN** the user runs `memon experiment status set E0001-foo --to FINISHED`
- **THEN** the command exits 2 with `{"error":{"code":"BAD_REQUEST","message":"unknown ExperimentStatus value 'FINISHED'; expected OPEN|RESOLVED|ABANDONED"}}`

### Requirement: `memon experiment readme write` reads content from stdin

`memon experiment readme write <id> --project-root <path> --expected-mtime <ms> [--expected-hash <sha1>]` SHALL read the new README content from stdin (until EOF) and apply the same atomic-write + mtime-lock + JOURNAL-status-event protocol as `experiment status set`. If `--expected-hash` is provided and the on-disk content's sha1 differs, the command SHALL exit 9 with `CONFLICT` even when mtime matches (defends against low-resolution mtime on NFS).

#### Scenario: Successful overwrite
- **WHEN** the user pipes new content into `memon experiment readme write foo-260501-100000 --project-root ./mock/project-a --expected-mtime <current>`
- **THEN** the README is replaced atomically; if status changed, a `[STATUS]` event is appended; stdout `{"ok":true,"mtime":<new>,"journalAppended":true|false}`; exit 0

#### Scenario: Hash mismatch with matching mtime
- **WHEN** `--expected-mtime` matches but `--expected-hash` does not
- **THEN** exit 9 with `CONFLICT`; file unchanged

### Requirement: `memon experiment warning` subcommands

The CLI SHALL expose `memon experiment warning` operating on the
**experiment doc**'s `## Warnings` section (the warnings table is now
exp-side per `experiment-readme`). The command set is the same as the
ADDED requirement above: `add` / `resolve` / `reopen` / `delete` /
`list`. The `add` subcommand accepts an optional `--run <run-dir>` flag
to populate the `Run` column.

`add` SHALL generate `Created` from the system clock with timezone
offset preserved, generate a `rowId` of the form
`w_<isoCreatedColonsToHyphens>_<4hex>`, and reject `--category` values
outside `{methodology, result, config, data, repro, compare, infra,
other}` with exit 2 `BAD_REQUEST`.

`resolve` SHALL set `Status=RESOLVED`, `Resolved=<now-ISO with offset>`,
and `Note=<--note>`. `--note` SHALL be required for `resolve`.

`reopen` SHALL set `Status=OPEN`, clear `Resolved` and `Note`, and
preserve `Created` and `Run`.

`delete` SHALL remove the row; the invocation detail SHALL include the
deleted row's complete content for reversibility.

#### Scenario: add with run attribution
- **WHEN** the user runs `memon experiment warning add E0001-foo --run
  bar-260501-100000 --category result --message "..."`
- **THEN** stdout is `{"ok":true,"rowId":"...","mtime":...}`, the `##
  Warnings` table on the exp doc has the new row with Run cell
  `bar-260501-100000`, and the automatic invocation includes a `[WARNING]` event with
  `run: "bar-260501-100000"`

#### Scenario: add without --run is exp-scoped
- **WHEN** the same command runs without `--run`
- **THEN** the new row's Run cell is `—`, the invocation detail has
  `run: null`

### Requirement: `memon experiment archive` toggles the `archived` frontmatter field

`memon experiment archive <id> --project-root <p>` SHALL set `archived: true` on the target's frontmatter (an exp doc when `<id>` matches `EXPERIMENT_FILENAME_REGEX`, a run README when `<id>` matches `RUN_DIR_REGEX` — the run-id form is a deprecation alias for `memon run archive`). `memon experiment unarchive <id> --project-root <p>` SHALL set `archived: false`. Both commands SHALL record a single `[ARCHIVE]` detail in the automatic invocation per `archive-frontmatter`'s "Archive subcommands write frontmatter atomically with mtime-lock + JOURNAL [ARCHIVE] event." Both SHALL bump the README / doc `updated_at` (the v3 wording "Neither command SHALL modify README.md or its mtime" no longer applies — the archive write IS a frontmatter mutation in v4).

The hard `archive-on-RUNNING` rule applies to the run-id form (or to a run-targeting `archive` command). The soft warning applies when archiving an already-archived target (no-op success with the warning suppressed per `archive-frontmatter`'s unarchive-doesn't-warn rule on the unarchive side).

#### Scenario: Archive a run via deprecation alias writes frontmatter
- **WHEN** the user runs `memon experiment archive foo-260513-100000 --project-root <p>` (run-id form)
- **THEN** stderr contains `[deprecation]` banner pointing to `memon run archive`
- **AND** the run's README has `archived: true` in frontmatter
- **AND** the automatic invocation includes a new `[ARCHIVE] \`foo-260513-100000\` op=archive` line
- **AND** README `updated_at` is bumped
- **AND** there is NO `<runDir>/.archived` sidecar created (the legacy mechanism is gone)

#### Scenario: Archive an exp doc writes frontmatter
- **WHEN** the user runs `memon experiment archive E0001-zero-snr-fix --project-root <p>` (exp-id form)
- **THEN** the doc's frontmatter has `archived: true`
- **AND** the automatic invocation includes a new `[ARCHIVE] \`E0001-zero-snr-fix\` op=archive` line

#### Scenario: Archive a RUNNING run is refused
- **GIVEN** a run with `status: RUNNING`
- **WHEN** the user runs `memon experiment archive <run-id>` or `memon run archive <run-id>`
- **THEN** the command exits 2 with `{"error":{"code":"BAD_REQUEST","message":"cannot archive a RUNNING run; set status to INTERRUPTED, FINISHED, or FAILED first"}}`

### Requirement: Read commands honor archive filter via `--include-archived`

`list` / `scan` / `show` / `search` / `journal read` / `hypo list` / `hypotheses read` SHALL skip experiments AND runs whose `archived: true` (per the frontmatter field, NOT the legacy sidecar) by default. A `--include-archived` flag SHALL include them. An `--archived-only` flag SHALL include only items with `archived: true`.

When the legacy `<runDir>/.archived` sidecar fallback path applies (per `archive-frontmatter`'s "Sidecar fallback during the migration window"), the read commands SHALL honor the fallback — i.e., a run whose README lacks the field but has the sidecar IS treated as archived for filter purposes.

#### Scenario: list excludes archived by default (frontmatter-driven)
- **GIVEN** a run whose README has `archived: true` in frontmatter
- **WHEN** the user runs `memon list --project-root <p>`
- **THEN** the run is NOT in the output

#### Scenario: list --include-archived includes both frontmatter and sidecar-fallback archived items
- **GIVEN** a project with one run archived via frontmatter (`archived: true`) and one archived via sidecar fallback (README lacks the field, sidecar exists)
- **WHEN** the user runs `memon list --project-root <p> --include-archived`
- **THEN** both runs are present in the output, each with `archived: true` on the record
- **AND** the sidecar-fallback run additionally has a parse warning `code: 'LEGACY_ARCHIVE_SIDECAR'`

#### Scenario: --archived-only filters to archived items
- **WHEN** the user runs `memon list --project-root <p> --archived-only`
- **THEN** only items with `archived: true` (per frontmatter or legacy sidecar) are returned

### Requirement: `memon install-skills` synchronises bundled skills into a project

`memon install-skills [--project-root <p>] [--target <path>] [--agent <list>] [--dry-run]` SHALL copy every `memon-*` subdirectory of the bundled `@memon/skills` source into one or more target directories. The command SHALL be a strict synchroniser of the `memon-*` namespace within each target:

- **Default target set (no `--target`, no `--agent`)**: ALL of `<projectRoot>/.claude/skills/`, `<projectRoot>/.codex/skills/`, `<projectRoot>/.opencode/skills/` SHALL be installed in a single run. When `--project-root` is omitted, `cwd` is used as `<projectRoot>`.
- **`--agent <list>`**: a comma-separated subset of `claude,codex,opencode` (or the literal `all`) SHALL select which agent dirs to install. The map from agent name to subpath is fixed: `claude → .claude/skills`, `codex → .codex/skills`, `opencode → .opencode/skills`. Unknown agent names SHALL exit 2 with `BAD_REQUEST`. The token `all` SHALL be the only value when present (mixing `all` with explicit agent names SHALL exit 2 with `BAD_REQUEST`).
- **`--target <path>`**: overrides per-agent derivation entirely; the install writes into exactly that one directory. `--target` and `--agent` SHALL be mutually exclusive (combining them exits 2 with `BAD_REQUEST`). `--target` and `--project-root` remain mutually exclusive.
- **Replacement scope per target**: every existing directory in the target whose name starts with `memon-` SHALL be removed before the fresh copy is written, including names that no longer exist in the bundled source. This rule applies independently to each target dir.
- **Non-namespaced skills are untouched per target**: directories not starting with `memon-` SHALL NOT be read, written, or deleted in any target.
- **Atomic-ish per skill**: each `memon-*` is removed and re-copied as a unit; partial copies inside a single skill dir are fine since the next install re-runs.
- **Dry-run**: `--dry-run` SHALL output the same `targets[]` JSON a real run would produce, without touching any file. The AGENTS.md prompt SHALL be skipped in dry-run mode (reported with `action: "skipped-dry-run"`).
- **JSON output shape**: when `--format json`, stdout SHALL be a single JSON object with keys `ok`, `source`, `targets`, `agentsLink`, `dryRun`. `targets` SHALL be an array; each entry has `agent` (one of `"claude" | "codex" | "opencode" | null`), `path` (absolute), `removed[]`, `installed[]`. The `agent` field SHALL be `null` when `--target` was used.

#### Scenario: Default install writes to all three agent dirs
- **WHEN** `memon install-skills --project-root /repo` runs with no `--agent` and no `--target`
- **THEN** all of `/repo/.claude/skills/`, `/repo/.codex/skills/`, and `/repo/.opencode/skills/` exist after the run
- **AND** each contains a fresh copy of every bundled `memon-*` directory
- **AND** stdout JSON has `targets.length === 3` with `agent` values `"claude"`, `"codex"`, `"opencode"` (in that order)

#### Scenario: --agent claude restores single-target install
- **WHEN** `memon install-skills --project-root /repo --agent claude` runs
- **THEN** only `/repo/.claude/skills/` is created/updated
- **AND** `/repo/.codex/skills/` and `/repo/.opencode/skills/` are NOT created if they did not previously exist
- **AND** stdout JSON has `targets.length === 1` with `agent: "claude"`

#### Scenario: --agent accepts comma-separated subset
- **WHEN** `memon install-skills --project-root /repo --agent claude,opencode` runs
- **THEN** `/repo/.claude/skills/` and `/repo/.opencode/skills/` are populated, `/repo/.codex/skills/` is NOT
- **AND** stdout JSON has `targets.length === 2` with `agent` values `"claude"` and `"opencode"`

#### Scenario: --agent all is equivalent to omitting --agent
- **WHEN** `memon install-skills --project-root /repo --agent all` runs
- **THEN** all three agent dirs are populated, identical to running with no `--agent` flag

#### Scenario: Unknown agent name exits 2
- **WHEN** the user runs `memon install-skills --agent claude,bard`
- **THEN** the command exits with code 2
- **AND** stderr contains a `BAD_REQUEST` error mentioning `bard` and the allowed values

#### Scenario: Mixing all with explicit names exits 2
- **WHEN** the user runs `memon install-skills --agent all,claude`
- **THEN** the command exits with code 2 with a `BAD_REQUEST` error

#### Scenario: --agent and --target are mutually exclusive
- **WHEN** the user runs `memon install-skills --agent claude --target /tmp/foo`
- **THEN** the command exits with code 2 with a `BAD_REQUEST` error

#### Scenario: Stale memon-* dir is removed independently in each target
- **GIVEN** `/repo/.claude/skills/memon-renamed-old/` and `/repo/.codex/skills/memon-renamed-old/` both exist
- **WHEN** `memon install-skills --project-root /repo` runs (default agents)
- **THEN** both `memon-renamed-old/` directories are deleted
- **AND** the corresponding `targets[]` entries each include `memon-renamed-old` in `removed[]`

#### Scenario: Non-namespaced skills are preserved per target
- **GIVEN** `/repo/.claude/skills/openspec-propose/` and `/repo/.opencode/skills/my-thing/` exist
- **WHEN** `memon install-skills --project-root /repo` runs
- **THEN** both directories' contents and mtimes are unchanged after the run

#### Scenario: --target overrides project-root derivation, agent is null
- **WHEN** `memon install-skills --target /opt/skills` runs
- **THEN** the command writes only to `/opt/skills`
- **AND** stdout JSON has `targets.length === 1` with `agent: null` and `path: "/opt/skills"`

#### Scenario: Default target with no --project-root uses cwd
- **WHEN** `memon install-skills` runs from `/repo` without flags
- **THEN** the targets are `/repo/.claude/skills/`, `/repo/.codex/skills/`, `/repo/.opencode/skills/`

### Requirement: `memon install-skills` offers an AGENTS.md → CLAUDE.md symlink

After a successful (non-`--dry-run`) install, `memon install-skills` SHALL inspect `<projectRoot>/AGENTS.md` and `<projectRoot>/CLAUDE.md` and react as follows. (When `--target` is used, "project root" for this check is the resolved `--project-root` or `cwd`, NOT the `--target` directory.)

- If `AGENTS.md` exists (regular file, symlink, anything `lstat`-able): take no action; report `action: "none"`.
- Else if `CLAUDE.md` does NOT exist: take no action; report `action: "none"`.
- Else (CLAUDE.md exists, AGENTS.md does not):
  - If `--format json`, OR stdin is not a TTY, OR `--dry-run`: SHALL NOT prompt; SHALL report `action: "skipped-non-tty"` (or `"skipped-dry-run"` for the dry-run case) and SHALL NOT create the symlink.
  - Otherwise: SHALL print one Chinese-language confirmation prompt (e.g. `是否创建 AGENTS.md → CLAUDE.md 软链接？(y/N)`) to stdout and read a single line from stdin. On `y`/`Y`/`yes` (case-insensitive), SHALL create `<projectRoot>/AGENTS.md` as a symlink whose target is the relative string `CLAUDE.md`, then report `action: "created"`. On any other answer (including empty line or EOF), SHALL report `action: "declined"` and create no symlink.
  - On a filesystem error during symlink creation (e.g. EPERM, ENOTSUP), SHALL catch the error and report `action: "failed"` with the error message in `agentsLink.error`. The overall command exit code SHALL still be 0 if the skill copy succeeded.
- The check SHALL run exactly once per invocation, AFTER all targets are processed (or AFTER dry-run reporting), regardless of how many targets there are.
- The reported state SHALL appear in the human-output trailer as a single line, and in JSON output as an `agentsLink` object with fields: `checked: true`, `claudeMdExists: boolean`, `agentsMdExists: boolean`, `action: "none" | "created" | "declined" | "skipped-non-tty" | "skipped-dry-run" | "skipped-no-input" | "failed"`, optional `error: string`.

#### Scenario: Both files already exist — no prompt
- **GIVEN** `<projectRoot>/AGENTS.md` and `<projectRoot>/CLAUDE.md` both exist
- **WHEN** `memon install-skills --project-root <projectRoot>` runs in an interactive terminal
- **THEN** no prompt is shown
- **AND** stdout JSON has `agentsLink.action === "none"` with `agentsMdExists: true`

#### Scenario: Neither file exists — no prompt
- **GIVEN** neither `AGENTS.md` nor `CLAUDE.md` exists at `<projectRoot>`
- **WHEN** `memon install-skills --project-root <projectRoot>` runs
- **THEN** no prompt is shown
- **AND** stdout JSON has `agentsLink.action === "none"` with `claudeMdExists: false`

#### Scenario: CLAUDE.md exists, AGENTS.md missing, interactive — accepts y
- **GIVEN** `<projectRoot>/CLAUDE.md` exists and `<projectRoot>/AGENTS.md` does not
- **WHEN** `memon install-skills --project-root <projectRoot>` runs in an interactive TTY and the user types `y` followed by Enter
- **THEN** `<projectRoot>/AGENTS.md` exists as a symlink whose readlink target is the literal string `CLAUDE.md`
- **AND** stdout JSON (if `--format json` were used) would report `agentsLink.action === "created"`

#### Scenario: CLAUDE.md exists, AGENTS.md missing, interactive — declined
- **GIVEN** the same state as the previous scenario
- **WHEN** the user types `n` (or just Enter) at the prompt
- **THEN** no symlink is created
- **AND** the command reports `agentsLink.action === "declined"`

#### Scenario: --format json suppresses the prompt
- **GIVEN** `<projectRoot>/CLAUDE.md` exists and `<projectRoot>/AGENTS.md` does not
- **WHEN** `memon install-skills --project-root <projectRoot> --format json` runs (even in an interactive TTY)
- **THEN** no prompt is shown
- **AND** stdout JSON has `agentsLink.action === "skipped-non-tty"`
- **AND** no symlink is created

#### Scenario: --dry-run suppresses both copy and prompt
- **WHEN** `memon install-skills --project-root <projectRoot> --dry-run` runs with CLAUDE.md present and AGENTS.md absent
- **THEN** no files are written and no symlink is created
- **AND** stdout JSON has `agentsLink.action === "skipped-dry-run"`

#### Scenario: Symlink creation failure does not fail the install
- **GIVEN** `<projectRoot>/CLAUDE.md` exists, `<projectRoot>/AGENTS.md` does not, the user accepts the prompt, but the filesystem rejects symlink creation (e.g. read-only mount)
- **WHEN** `memon install-skills --project-root <projectRoot>` runs
- **THEN** the command exits with code 0
- **AND** stdout JSON has `agentsLink.action === "failed"` with a non-empty `error` string
- **AND** the skill copy results in `targets[]` are unaffected

### Requirement: `memon hypotheses read` mirrors the web API

`memon hypotheses read --project-root <path>` SHALL output `{path, legendBlock, summaryTableBlock, entries, parseErrors, parseWarnings}` matching the web `/api/hypotheses` JSON exactly. (The existing `memon hypo list/show` commands continue to work for human use; this is the agent-shaped equivalent.)

#### Scenario: Read mock hypotheses
- **WHEN** the user runs `memon hypotheses read --project-root ./mock/project-a`
- **THEN** stdout JSON has `entries.length === 6` and the same field names as `/api/hypotheses`

### Requirement: Stable exit-code dictionary

The CLI SHALL use this exit code table for all subcommands. Skills depend on these for branch logic.

| code | semantic |
|---|---|
| 0 | success |
| 1 | generic / unclassified failure |
| 2 | usage / flag error (including Commander option and argument parse failures) |
| 4 | NOT_FOUND (resource doesn't exist) |
| 9 | CONFLICT (mtime / hash lock failure — skill should refresh and retry) |
| 11 | MEMON_TOO_OLD (project's `fs_convention_version` exceeds `FS_CONVENTION_VERSION`; user must upgrade memon) |
| 13 | FORBIDDEN (path safety / permission) |

Every classified failure (BAD_REQUEST, NOT_FOUND, CONFLICT, FORBIDDEN, MEMON_TOO_OLD) SHALL be written to stderr as the structured envelope `{"error":{"code","message","details?"}}` in both human and JSON output modes, and SHALL be recorded in the invocation receipt with the same code, so a lock conflict is recorded as a conflict rather than as an interrupted invocation. The exit code SHALL be derived from the error code by this table.

#### Scenario: Skill retries on exit 9
- **WHEN** any write command exits with code 9
- **THEN** the stderr JSON has `error.code === "CONFLICT"` and stdout/stderr include enough state for the caller to retry without losing intent (current mtime + current content for README writes; current frontmatter for digest-mark)

#### Scenario: Status and README lock conflicts use the structured envelope
- **WHEN** `memon run status set`, `memon run readme write`, `memon experiment status set` or a `memon experiment warning` write finds the on-disk mtime or hash differs from the expected value
- **THEN** the command exits 9
- **AND** stderr is one `{"error":{"code":"CONFLICT",…,"details":{…}}}` line whose `details` carries the current mtime (and the current or actual hash when a hash was compared)
- **AND** the invocation receipt records the outcome as a conflict

#### Scenario: Missing hypothesis or run exits 4
- **WHEN** `memon hypo show <id>` names a hypothesis that does not exist, or `memon show <id>` names a run that does not exist
- **THEN** the command exits 4
- **AND** stderr carries `{"error":{"code":"NOT_FOUND",…}}` and stdout is empty, regardless of `--format`

#### Scenario: Parser failure exits 2
- **WHEN** Commander rejects the command line (unknown option, missing required argument, invalid choice)
- **THEN** the command exits 2
- **AND** the invocation receipt, when one is written, records `BAD_REQUEST`

#### Scenario: Forward-incompatible project root exits 11
- **GIVEN** `<root>/.memon/version.json` has `fs_convention_version: 5` and the running memon has `FS_CONVENTION_VERSION === 3`
- **WHEN** any command that preflights FS version runs against `<root>` (`memon install-skills`, `memon fs-version check`, or any preflight-checking skill invocation)
- **THEN** the command exits with code 11
- **AND** the stderr JSON has `error.code === "MEMON_TOO_OLD"`
- **AND** the message names both the project's version and the tool's version

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

### Requirement: `memon experiment` subcommand family

The CLI SHALL expose `memon experiment` as a parent command with the following subcommands. All write subcommands SHALL emit JSON status objects on stdout (`{"ok":true, ...}`) on success and structured error JSON on failure; all read subcommands SHALL default to JSON output and support `--format human` for tabular output.

```
memon experiment ls               [--project-root <p>]
memon experiment show             <id-or-slug> [--project-root <p>]
memon experiment create           <slug> [--title <t>] [--hypotheses <H,H,...>]
                                  [--from-run <run-dir>] [--project-root <p>]
memon experiment rename           <id-or-slug> <new-slug> [--project-root <p>]
memon experiment link             <id> <run-dir-or-id> [--project-root <p>]
memon experiment unlink           <id> <run-dir-or-id> [--project-root <p>]
memon experiment delete           <id> [--force] [--project-root <p>]
memon experiment results table    <id-or-slug> [--variant <ids>] [--status <statuses>]
                                  [--column <keys>] [--group <group>] [--output <fmt>]
memon experiment warning add      <id> [--run <run-dir>] --category <cat>
                                  --message <text> [--expected-mtime <ms>]
                                  [--expected-hash <sha1>]
memon experiment warning resolve  <id> <rowId> --note <text>
                                  [--expected-mtime <ms>] [--expected-hash <sha1>]
memon experiment warning reopen   <id> <rowId> [--note <text>]
                                  [--expected-mtime <ms>] [--expected-hash <sha1>]
memon experiment warning delete   <id> <rowId>
                                  [--expected-mtime <ms>] [--expected-hash <sha1>]
memon experiment warning list     <id> [--status open|resolved|all]
```

The `id` argument SHALL accept either the canonical `E<NNNN>-<slug>` form or the slug alone (when the slug uniquely identifies an experiment). The `link`/`unlink` `<run-dir-or-id>` argument and `--from-run` accept a project-relative Run path or a unique Run ID; an ambiguous ID is rejected with its candidate paths. These commands edit the Experiment declaration only. The `--run <run-dir>` option on `warning add` populates the `Run` column of the new row; absence means the warning is exp-scoped (rendered as `—`).

The `experiment create` and `experiment rename` commands' behaviors are detailed in the `experiment-edit` capability; the `experiment link` / `unlink` / `delete` commands' behaviors are detailed there as well.

The `experiment warning *` write commands SHALL:
- Use the section-bound writer for `## Warnings` defined in `experiment-readme`.
- Record a `[WARNING]` detail in the automatic invocation per write, including the `run` attribution.

#### Scenario: `experiment ls` returns JSON list
- **WHEN** the user runs `memon experiment ls --project-root <p>`
- **THEN** stdout is JSON `{"experiments": [...]}` with one entry per exp doc, including effective times computed from member runs

#### Scenario: `experiment warning add` requires a run for run-scoped
- **WHEN** the user runs `memon experiment warning add E0001 --run bar-260501-100000 --category result --message "..."`
- **THEN** the new row's `Run` cell is `bar-260501-100000`, the `[WARNING]` event has `run: "bar-260501-100000"`, and stdout is `{"ok":true,"rowId":"...","mtime":...}`

#### Scenario: `experiment warning add` without --run is exp-scoped
- **WHEN** the same command runs without `--run`
- **THEN** the new row's `Run` cell is `—`, the `[WARNING]` event has `run: null`

#### Scenario: `experiment rename` is listed in the subcommand family
- **WHEN** the user runs `memon experiment --help`
- **THEN** the printed subcommand list includes `rename <id-or-slug> <new-slug>` between `create` and `link`
- **AND** the detailed behavior of the command is detailed in the `experiment-edit` capability

### Requirement: `memon run` subcommand family

The CLI SHALL expose `memon run` as a parent command with the following
subcommands. The behavior of `memon run rename` is detailed in the
`run-edit` capability.

```
memon run ls                 [--project-root <p>] [--include-archived]
memon run show               <id-or-slug> [--project-root <p>]
memon run rename             <id-or-dir> <new-slug> [--project-root <p>]
memon run status set         <id> --to <STATUS> [--expected-mtime <ms>]
memon run readme write       <id> [--expected-mtime <ms>] [--expected-hash <sha1>]
memon run journal read       [--project-root <p>] [--since <ISO>] [--tag <T>]
                              [--run-id <id>] [--limit <N>]
memon run archive            <id> [--project-root <p>]
memon run unarchive          <id> [--project-root <p>]
```

These subcommands operate on run directories (the
`logs/<slug>-<YYMMDD>-<HHMMSS>/` form). Their semantics are equivalent
to the v2 `memon experiment …` commands that previously operated on the
same dirs, with these v3-specific differences:
- `run readme write` updates the `updated_at` field in the supplied
  content per `run-edit`'s save handshake (the CLI does NOT auto-bump
  `updated_at`; it accepts whatever the caller sends).
- `run rename` rewrites the declaring Experiment's `runs[]` path (the
  owner is derived from Experiment declarations); it never reads or
  writes a Run-side parent field.

#### Scenario: `run ls` returns JSON list
- **WHEN** the user runs `memon run ls --project-root <p>`
- **THEN** stdout is `{"runs": [...]}` with one entry per run dir,
  including the parent Experiment derived from declarations when one exists

#### Scenario: `run rename` updates parent exp atomically
- **WHEN** a run declared by `E0001-foo` is renamed via `memon run
  rename`
- **THEN** the corresponding `E0001-foo.runs[]` entry is updated to the
  new project-relative path in the same operation, and the Run README
  gains no `experiment` field

### Requirement: `memon share` subcommand family

The CLI SHALL gain a new top-level subcommand `memon share` with three children:

- `memon share create <project> [--label <text>] [--expires <duration>] [--format human|json]`
- `memon share list [--project <P>] [--format human|json]`
- `memon share revoke <id-prefix-or-label> [--project <P>] [--force] [--format human|json]`

Behavior is fully specified in the `project-share` capability spec. This requirement establishes the CLI surface shape:

- The subcommands SHALL be registered in `packages/cli/src/commands/share.ts` and exposed from the main `memon` binary via the standard subcommand dispatch in `packages/cli/src/index.ts`.
- Like every other `memon` subcommand, the default output format SHALL be `json`. `--format human` switches to a human-readable table (`memon share list`) or terse status line (`memon share create` / `memon share revoke`).
- The subcommands SHALL exit non-zero on error and print a short message to stderr. Standard exit codes from the existing CLI surface apply: `0` success, `1` runtime error, `2` usage error.
- The subcommands SHALL resolve `<projectRoot>` from `cfg.projects` (via the standard config loader) — there is no `--project-root` shortcut for `memon share`, the project name is the canonical key.
- The CLI SHALL accept a `--duration` syntax of `<int>d`, `<int>h`, or `never` for `--expires`. Invalid duration strings fail usage validation (exit code 2).
- `memon share create` SHALL print the constructed share URL on stdout in human mode and include it in the JSON record in JSON mode (key `share_url`).
- The `token` field SHALL be OMITTED from `memon share list` output (both human and JSON) to avoid leaking when piped to logs. `memon share create` returns the freshly-generated token in its output because that is the one moment when the owner needs to copy it. `memon share revoke` does NOT return the token of the revoked record.

#### Scenario: `memon share create` JSON output
- **WHEN** an owner runs `memon share create project-a --label Alice` (JSON default)
- **THEN** stdout is a JSON object: `{ "id": "shr_...", "project": "project-a", "label": "Alice", "token": "<24chars>", "created_at": "...", "expires_at": null, "share_url": "https://.../share/project-a/<token>" }`
- **AND** the exit code is 0

#### Scenario: `memon share create` human output
- **WHEN** an owner runs `memon share create project-a --format human`
- **THEN** stdout has the single line `https://.../share/project-a/<token>` and a trailing newline
- **AND** stderr is silent

#### Scenario: `memon share list` JSON across all projects
- **WHEN** an owner runs `memon share list` with two configured projects each having one share
- **THEN** stdout is a JSON array of 2 objects, each with `{ id, project, label, created_at, expires_at }` — NO `token` field

#### Scenario: `memon share list` filtered by project
- **WHEN** an owner runs `memon share list --project project-a --format human`
- **THEN** stdout is a table with columns `ID | Label | Created | Expires` listing only project-a's shares
- **AND** the `Token` column is absent

#### Scenario: `memon share revoke` unique id-prefix
- **WHEN** an owner runs `memon share revoke shr_abc --project project-a` and exactly one share matches
- **THEN** the matching record is removed from `<projectRoot>/.memon/shares.json`
- **AND** stdout (JSON default) is `{ "revoked": { "id": "shr_abc...", "project": "project-a", ... } }`
- **AND** the exit code is 0

#### Scenario: `memon share revoke` ambiguous without `--project`
- **WHEN** the prefix `shr_a` matches records in TWO different projects and `--project` is not supplied and `--force` is not supplied
- **THEN** the command exits with code 2 (usage error)
- **AND** stderr lists the candidate `(project, id)` pairs and instructs the user to disambiguate

#### Scenario: `memon share revoke` not found
- **WHEN** no record matches the given prefix/label
- **THEN** the command exits with code 1 (runtime error)
- **AND** stderr prints `share not found: <prefix>`

#### Scenario: `memon share create` with `--expires`
- **WHEN** an owner runs `memon share create project-a --expires 30d`
- **THEN** the resulting record's `expires_at` is `created_at + 30 days` in ISO8601+TZ
- **AND** the JSON output reflects the non-null `expires_at`

#### Scenario: `memon share create` invalid duration
- **WHEN** an owner runs `memon share create project-a --expires foo`
- **THEN** the command exits with code 2 (usage error)
- **AND** stderr reads `invalid --expires value: expected <int>d, <int>h, or "never"`

#### Scenario: Unknown project
- **WHEN** an owner runs `memon share create not-configured-project`
- **THEN** the command exits with code 1
- **AND** stderr reads `project not configured: not-configured-project`

### Requirement: memon experiment warning subcommands resolve exp-id via v5-aware discovery

The CLI's `memon experiment warning {add, list, resolve, reopen, delete}` subcommands SHALL resolve their first positional argument when it matches `^E\d{4}-[a-z0-9][a-z0-9-]*$` (the canonical exp-id form, `EXP_ID_RE`) by calling the core library's `discoverExperiments(projectRoot, projectName)` and selecting the returned record whose `.id` equals the supplied id, then using that record's `.path` field as the read/write target (already the absolute path to the exp doc README under the v5 folder layout, with the legacy v4 file form supported as a transitional `LEGACY_LAYOUT` fallback). The CLI SHALL NOT construct the README path manually as `join(projectRoot, 'docs', 'experiments', '${id}.md')` — that hard-coded form was correct under v4 but silently 404s on v5 layouts. When `discoverExperiments` returns no record matching the supplied id, the CLI SHALL exit with `NOT_FOUND` and stderr message `experiment "<id>" not found in <projectRoot>`. The run-dir-form branch (first argument does not match `EXP_ID_RE`, treated as a v2 run-dir base name, resolved via `scanProjectRoot`) SHALL remain unchanged.

#### Scenario: warning add resolves exp-id to v5 folder README
- **GIVEN** a project root with `docs/experiments/E0001-foo/README.md` containing the canonical `## Warnings` table header
- **WHEN** the user runs `memon experiment warning add E0001-foo --run bar-260501-100000 --category result --message "loss diverges" --project-root <root>`
- **THEN** the CLI writes the new row to `docs/experiments/E0001-foo/README.md` (the v5 location)
- **AND** the invocation `[WARNING]` detail carries `` `E0001-foo` op=add ... run=bar-260501-100000 ... ``
- **AND** the response is `{"ok":true,"rowId":"w_...","mtime":...}`

#### Scenario: warning add resolves exp-id to legacy v4 file during migration
- **GIVEN** a project root mid-migration with `docs/experiments/E0001-foo.md` still in legacy file form (no folder yet — the migration has not run for this id)
- **WHEN** the user runs `memon experiment warning add E0001-foo --category result --message "..." --project-root <root>`
- **THEN** the CLI writes the new row to `docs/experiments/E0001-foo.md` (the legacy file location, since `discoverExperiments` reports it under the `LEGACY_LAYOUT` fallback)
- **AND** the operation succeeds (no NOT_FOUND)

#### Scenario: warning add against non-existent exp-id returns NOT_FOUND
- **GIVEN** a project root with no `docs/experiments/E0099-*` folder or file
- **WHEN** the user runs `memon experiment warning add E0099-missing --category result --message "..."`
- **THEN** the CLI exits with `NOT_FOUND` and stderr names the missing id
- **AND** no file is written
- **AND** no legacy Journal file is modified

#### Scenario: warning list reads via v5-aware discovery
- **GIVEN** a project root with `docs/experiments/E0001-foo/README.md` containing one warning row
- **WHEN** the user runs `memon experiment warning list E0001-foo`
- **THEN** stdout is `{"ok":true,"warnings":[{...one row...}],"mtime":...,"hash":...}`

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

### Requirement: Structured Experiment document commands are read and check surfaces

The CLI SHALL expose `memon experiment doc show <id> <section>`, `render <id> <section>`, `validate <id>`, and `lint <id>` for v6 Experiment bundles. `section` SHALL be one of `implementation`, `investigation`, or `results`. Human show/render output SHALL use Core's deterministic Markdown projection; JSON output SHALL include structured diagnostics. Validate and lint SHALL exit non-zero when any error diagnostic exists.

The CLI SHALL NOT expose item-level create, update, delete, reorder, or status-mutation commands for the YAML trees or Variants. Agents may edit the YAML source files directly. The focused Results annotation upsert described below is the sole optional metadata-write convenience and SHALL NOT become a required write gate.

#### Scenario: Managed section renders for a human
- **WHEN** the user runs `memon --project-root . --format human experiment doc render E0001-example results`
- **THEN** stdout contains the Core-generated human-readable Results Markdown
- **AND** no source file is modified

#### Scenario: Strict lint preserves incompatible content
- **GIVEN** an Experiment README has an unsupported `## Plan` body
- **WHEN** `memon --project-root . --format json experiment doc lint E0001-example` runs
- **THEN** it exits non-zero with an `UNKNOWN_H2_SECTION` error
- **AND** the README remains byte-unchanged and readable

### Requirement: `memon experiment results table` reads results as a selectable flat table

`memon experiment results table <id-or-slug> [--variant <ids>] [--status <statuses>] [--column <keys>] [--group <group>] [--output <fmt>]` SHALL read `results.yaml` for the named experiment, project it as a flat table with one row per Variant, and emit the result in the requested format.

**Filters:**

| Flag | Purpose |
|------|---------|
| `--variant <ids>` | Comma-separated Variant IDs to include (default: all) |
| `--status <statuses>` | Comma-separated status values (`PLANNED`/`RUNNING`/`COMPLETED`/`FAILED`/`INCONCLUSIVE`/`DROPPED`) |
| `--column <keys>` | Comma-separated column keys to include (default: all) |
| `--group <group>` | Column group filter: `parameter`, `metric`, or `all` (default: `all`) |

Filters are AND-composed. Column ordering preserves the declaration order from `results.yaml`.

**Output formats (`--output`):**

| Format | Behavior |
|--------|----------|
| `json` (default) | Structured object with `experimentId`, `resultsSchemaVersion`, `columns`, `rows`, `meta` |
| `human` | Aligned terminal table with `─` separators |
| `csv` | RFC 4180 CSV; `runs_count` / `attempts_count` as integer columns |
| `markdown` | GFM table with bold Variant IDs |
| `yaml` | Structured YAML mirroring the JSON envelope |

**Row shape (JSON/YAML):**

```jsonc
{
  "variantId": "V0001",
  "variantName": "BF16",
  "status": "COMPLETED",
  "runs": ["run-a"],
  "attempts": [],
  "values": { "precision": "bf16", "accuracy": 0.95 }
}
```

**Meta shape:**

```jsonc
{
  "totalVariants": 3,
  "filteredVariants": 1,
  "filters": { "columnGroup": "metric", "variants": ["V0001"], "columns": ["accuracy"] }
}
```

**Error contract:**

| Condition | exit code | stderr `error.code` |
|-----------|-----------|---------------------|
| Experiment not found | 4 (`NOT_FOUND`) | `NOT_FOUND` |
| `results.yaml` missing | 4 (`NOT_FOUND`) | `NOT_FOUND` |
| `results.yaml` parse error | 1 (`GENERIC`) | `INVALID_RESULTS` |

Empty filter results are not errors — the command returns zero rows with `meta.filteredVariants: 0`.

#### Scenario: Default JSON output returns all variants
- **WHEN** the user runs `memon experiment results table E0001-foo --output json`
- **THEN** stdout is valid JSON with `rows.length` equal to the number of variants in `results.yaml`
- **AND** each row contains `variantId`, `variantName`, `status`, `runs`, `attempts`, and `values`

#### Scenario: --variant filters to specific Variants
- **WHEN** the user runs `memon experiment results table E0001-foo --variant V0001,V0003 --output json`
- **THEN** only rows whose `variantId` is `V0001` or `V0003` appear in `rows`
- **AND** `meta.filters.variants` is `["V0001", "V0003"]`

#### Scenario: --group metric excludes parameter columns
- **WHEN** the user runs `memon experiment results table E0001-foo --group metric --output json`
- **THEN** every column in `columns` has `group: "metric"`
- **AND** `meta.filters.columnGroup` is `"metric"`

#### Scenario: --output csv produces RFC 4180 output
- **WHEN** the user runs `memon experiment results table E0001-foo --output csv`
- **THEN** the first line is a comma-separated header: `variant_id,variant_name,status,<column keys...>,runs_count,attempts_count`
- **AND** each subsequent line is a data row with values in the same column order

#### Scenario: Missing results.yaml exits NOT_FOUND
- **GIVEN** an experiment with no `results.yaml`
- **WHEN** `memon experiment results table <id>` runs
- **THEN** stderr contains `{"error":{"code":"NOT_FOUND","message":"results.yaml not found for experiment \"<id>\""}}`
- **AND** exit code is 4

### Requirement: Results summary exposes table shape without cell values

`memon experiment results summary <id-or-slug> [--output <fmt>]` SHALL return
declared columns and Variant row identities without returning parameter/metric
cell values, Runs, Attempts, or provenance. Each column SHALL include its key,
label, group, type, options when present, and optional column/value
descriptions. Each row SHALL include only Variant `id`, `name`, and `status`.

#### Scenario: Agent inspects Results shape safely
- **WHEN** an Agent runs `memon experiment results summary E0001-example --output json`
- **THEN** stdout contains column and row counts, column schemas, annotations, and Variant identities
- **AND** stdout contains no `parameters`, `metrics`, `runs`, `attempts`, or provenance

### Requirement: Focused Results annotation commands are optional idempotent helpers

`memon experiment results annotation get <id> [--column <key>] [--value <value>]`
SHALL read all annotations or one selected description.
`memon experiment results annotation set <id> <column> [--value <value>]
--description <markdown>` SHALL atomically add or replace the selected column
description or value description in `results.yaml`. Set SHALL require a
declared column but SHALL NOT require `--value` to occur in enum `options`.
Direct YAML editing SHALL remain supported and documented.

#### Scenario: Existing value description is replaced
- **GIVEN** column `precision` already describes value `bf16`
- **WHEN** annotation set targets the same column and value with new Markdown
- **THEN** exactly that description is replaced atomically
- **AND** unrelated YAML keys are retained

### Requirement: Warning compatibility commands remain permanently deprecated

All existing `memon experiment warning ...` commands and `memon run warning add ...` SHALL remain functional indefinitely. Each CLI invocation SHALL print exactly one permanent `[deprecated]` line to stderr directing agents to `memon-write-experiment-doc`. This warning-specific notice SHALL NOT declare a removal release and SHALL NOT be suppressed by `MEMON_QUIET_DEPRECATIONS`.

#### Scenario: Warning command emits one permanent notice
- **WHEN** the user invokes any retained warning command with `MEMON_QUIET_DEPRECATIONS=1`
- **THEN** stderr still contains exactly one `[deprecated]` notice
- **AND** the compatibility operation executes normally

### Requirement: `memon serve` accepts only instance configurations

`memon serve` SHALL treat `config.example.yml` as a protected documentation
template, not a valid active server configuration. Default resolution SHALL
continue to inspect only `<cwd>/config.yml` and `<repo-root>/config.yml`; the
presence of `config.example.yml` SHALL NOT satisfy the requirement for a
configuration file.

If `--config <path>` resolves to a path whose final component is exactly
`config.example.yml`, the command SHALL reject it before spawning Next.js and
print a structured, actionable error directing the operator to copy the
template to `config.yml` or another instance path. Explicit non-example paths
remain valid and are exported through `MEMON_CONFIG_PATH` under the existing
serve contract.

#### Scenario: Only the example exists during default serve

- **GIVEN** `config.example.yml` exists in the repository but no `config.yml`
  exists in cwd or the repository root
- **WHEN** the user runs `memon serve`
- **THEN** the command exits with a structured error explaining how to create
  an instance configuration
- **AND** it does not spawn Next.js
- **AND** it does not modify or copy `config.example.yml`

#### Scenario: Explicit example path is rejected

- **WHEN** the user runs `memon serve --config ./config.example.yml`
- **THEN** the command exits non-zero before spawning Next.js
- **AND** stderr identifies `config.example.yml` as a template and recommends
  an instance path
- **AND** no runtime environment is allowed to persist into that file

#### Scenario: Explicit custom instance path remains supported

- **GIVEN** `/etc/memon/cluster.yml` is a valid configuration
- **WHEN** the user runs `memon serve --config /etc/memon/cluster.yml`
- **THEN** the command spawns the web server with
  `MEMON_CONFIG_PATH=/etc/memon/cluster.yml`
- **AND** first-run authentication persistence may update that instance under
  the `auth-system` contract

### Requirement: CLI serves explicit central and Backend roles

The legacy role split is retired. Memon serve SHALL start the actual custom unified Web/API server with the selected instance configuration, not a framework-only server that bypasses authentication and project services. It SHALL NOT offer a remote Backend service role.

#### Scenario: Configured central serve
- **WHEN** memon serve starts with a valid instance configuration
- **THEN** its configured listener serves both Web and public API with project authorization

### Requirement: Ordinary cluster-local CLI commands remain local

Native project read/write/lint/skill commands SHALL operate on their selected project roots without central availability, service tokens, Backend listeners or central observation caches.

#### Scenario: Central unavailable
- **WHEN** an ordinary native CLI read is requested
- **THEN** it reads the selected project directly without probing a service

### Requirement: Legacy Hub/Node config is rejected
The CLI/config loader SHALL reject abandoned `hub:` or `node:` blocks with a clear migration message and SHALL NOT start the node-initiated WebSocket implementation.

#### Scenario: Old node config cannot silently start
- **WHEN** an instance config contains the abandoned `node:` block
- **THEN** startup fails with guidance to use central project-root configuration

### Requirement: `memon wiki` command group is registered on the binary

The `memon` binary SHALL expose a `wiki` parent command, implemented in `packages/cli/src/commands/wiki.ts` and registered through the standard subcommand dispatch in `packages/cli/src/index.ts`, with the child subcommands `ls`, `show`, `create`, `move`, `set`, `review`, `lint`, `backlinks`, `migrate-report`, `commit`, `components`, `deprecate`, `undeprecate`, and `delete`. Like every other non-`serve` family it SHALL resolve its project context from `--project-root <path>` (falling back to `cwd`) with no `config.yml` lookup and no `--config` flag, SHALL default to machine-readable JSON on stdout with `--format human` available, and SHALL use the CLI-wide exit-code table. The per-subcommand flags, output projections, validation rules, and error semantics are defined by the `wiki-cli` capability and SHALL NOT be restated here.

#### Scenario: `wiki` is dispatchable from the binary
- **WHEN** the user runs `memon wiki --help`
- **THEN** stdout lists `ls`, `show`, `create`, `move`, `set`, `review`, `lint`, `backlinks`, `migrate-report`, `commit`, `components`, `deprecate`, `undeprecate`, and `delete`, exit code 0

#### Scenario: Wiki commands take `--project-root`, not `--config`
- **WHEN** the user runs `memon wiki ls --config /tmp/config.yml`
- **THEN** the command parser rejects the unknown option with a non-zero exit and no configuration file is read

### Requirement: Project scan excludes diagnostic history

The CLI SHALL return the existing project, scan-time, run/experiment and hypothesis snapshot fields without a journal field. Default scan SHALL NOT read legacy Journal files or activity receipts. Human output SHALL not report a digest cursor. Diagnostic history SHALL be queried explicitly through journal read, not embedded into normal scans.

#### Scenario: Scan without Journal permissions
- **GIVEN** research documents are readable but diagnostic history is unavailable
- **WHEN** the user runs a normal scan
- **THEN** the research snapshot succeeds without reading diagnostic history or inserting a fake empty journal object

### Requirement: Journal diagnostic query uses typed filters and stable paging

`memon journal read` SHALL provide explicit diagnostic history with AND-composed `--since`, `--tag`, `--experiment-id`, `--run-id`, `--limit` and opaque `--cursor` filters. Default limit SHALL be 200 and maximum 1000. Timestamps SHALL compare as instants across timezone offsets. Output SHALL include events, nextCursor and origin/typed association information, not an active lastDigestAt. Experiment IDs and Run IDs SHALL be validated separately; a run-shaped experiment-id SHALL fail with an actionable run-id hint. Stable pagination SHALL not skip tied timestamps.

#### Scenario: Entity filtering is real
- **GIVEN** history contains operations for E0001 and E0002
- **WHEN** journal read filters E0001
- **THEN** no E0002-only operation is returned

#### Scenario: Separate Run filter
- **WHEN** the user supplies `--run-id alpha-260901-100000`
- **THEN** only events explicitly associated with that Run are returned

#### Scenario: Legacy misnamed filter rejected
- **WHEN** the user supplies `--experiment-id alpha-260901-100000`
- **THEN** the command fails with BAD_REQUEST and points to --run-id rather than silently ignoring the filter

### Requirement: Automatic capture submission computes bounded fingerprints

The CLI SHALL expose journal submit --files as defined by activity-capture. It SHALL compute bounded document fingerprints and SHALL NOT accept Journal prose or expose unimplemented evidence show/check/confirm/revoke commands.

#### Scenario: Lint is a pure read
- **WHEN** document lint runs
- **THEN** it creates neither an activity receipt nor evidence-confirmation metadata

### Requirement: Removed authoring commands fail without side effects

The CLI SHALL remove Journal append/digest-mark registrations and their authoring helpers. Invocations SHALL fail clearly rather than run a compatibility writer. Doctor and separate document validate commands SHALL remain retired; structural lint is the supported check workflow.

#### Scenario: Old append invocation
- **WHEN** an old skill invokes journal append
- **THEN** the command fails without changing legacy history or creating a narrative receipt

### Requirement: CLI remains direct and independent of central cache
Remote CLI commands SHALL read/write project files directly and retain existing filesystem formats, status permissions and optimistic-lock behavior. They SHALL not require a central connection, a persistent cache daemon, or cache notification integration. Backend serving/lifecycle commands SHALL be removed while central memon serve remains available in the central installation.

#### Scenario: Offline CLI
- **WHEN** central is unavailable
- **THEN** local experiment and Wiki CLI operations continue without cache synchronization

### Requirement: CLI target operations avoid unrelated Run reads
CLI commands that operate on identified Runs SHALL locate directory paths without reading all Run documents or hypotheses. Batch member mutations SHALL reuse one discovery within the command rather than rediscover for each member. Discovery SHALL start only at project-root logs/, outputs/, and experiments/. Independent Run operations MAY use bounded concurrency; no Web queue, TTL cache or artificial rate delay SHALL mediate CLI filesystem access.

#### Scenario: Single Run mutation
- **WHEN** a command changes one identified Run and an unrelated Run README is unreadable
- **THEN** unrelated content is not read merely to locate the target

#### Scenario: Cascade unlink
- **WHEN** an Experiment with multiple member Runs is deleted with explicit cascade authorization
- **THEN** member paths are located once and only the relevant member documents are read or changed

### Requirement: Markdown source target resolution belongs only to Web
CLI Markdown operations SHALL preserve source-reference values and validate their syntax without resolving target existence, metadata or staleness. This SHALL apply to Wiki and other Markdown source references. Web SHALL retain target resolution using the shared file Store. CLI source filters and backlinks MAY compare reference tokens without opening targets. Explicit migration or mutation of a target object SHALL still read the object it acts upon.

#### Scenario: Wiki source references a Run
- **WHEN** a CLI Wiki read, creation, edit or lint encounters a Run source reference
- **THEN** it does not discover Runs or read Run content to resolve that reference

### Requirement: Independent Wiki file operations are fully concurrent
Independent CLI Wiki file operations SHALL have no application-level concurrency throttle. Same-file locking, read-before-write dependencies, and mutation ordering required for correctness SHALL remain sequential.

#### Scenario: Multiple Wiki documents
- **WHEN** independent Wiki documents must be read
- **THEN** the CLI submits their reads concurrently without joining the Web scheduler or enforcing a Wiki operation semaphore

### Requirement: Memon update pulls and installs latest CLI and skills
memon update SHALL fetch/pull the latest source from the configured trusted publication upstream with fast-forward-only semantics and install the CLI and bundled managed skills. It SHALL report selected revision and action results, preserve user-authored files, and refuse dirty/divergent source rather than reset or stash it. It SHALL avoid Web builds, Backend startup, remote test suites and central SHA equality. Installation failure SHALL retain a usable prior installation.

#### Scenario: Normal update
- **WHEN** a clean CLI installation invokes memon update with reachable upstream
- **THEN** latest source is pulled and CLI/managed skills are updated without remote unit tests

#### Scenario: Dirty checkout
- **WHEN** local source modifications or divergence prevent a safe update
- **THEN** the command reports the problem and preserves local work and the usable installation

#### Scenario: Install failure
- **WHEN** new CLI installation fails
- **THEN** the previous usable CLI remains available and the command reports failure

#### Scenario: Custom skills
- **WHEN** a user has skills outside the managed bundle boundary
- **THEN** updating bundled skills does not overwrite those files

### Requirement: `install-skills` refuses the harness checkout

`memon install-skills` SHALL exit 2 with `BAD_REQUEST`, before writing anything, when the resolved project root is a memon harness checkout, recognized by `packages/skills/package.json` declaring the package name `@memon/skills`. The message SHALL state that bundled skills live in `packages/skills/` and are installed into research projects.

#### Scenario: Run inside the harness checkout
- **WHEN** the operator runs `memon --project-root <harness checkout> install-skills`
- **THEN** the command exits 2 and no agent skill directory under the checkout changes

#### Scenario: Ordinary project
- **WHEN** the project root has no `packages/skills/package.json` naming `@memon/skills`
- **THEN** installation proceeds as before

### Requirement: CLI Run walks accept declared Run locations
Because the CLI has no project-level configuration source, the CLI SHALL accept a repeatable global `--run-dir <pattern>` option with the meaning and validation of the Project `run_dirs` setting. When given, every Run walk the invocation performs (project scan, run listing/show/search and Run target resolution by base name) SHALL expand only those patterns; when omitted, walks SHALL stay unbounded. An invalid pattern SHALL fail with `BAD_REQUEST` (exit code 2) before the project is read. Resolution of a project-relative Run path SHALL NOT depend on the patterns.

#### Scenario: Declared scan
- **WHEN** `memon --run-dir 'logs/*' scan .` runs in a project with Runs at `logs/<run>` and `outputs/<group>/<run>`
- **THEN** the snapshot contains the `logs/<run>` Runs and not the `outputs/<group>/<run>` Runs

#### Scenario: Invalid pattern
- **WHEN** `memon --run-dir 'logs/**' scan .` runs
- **THEN** the command exits with code 2 and a `BAD_REQUEST` error naming `--run-dir`

#### Scenario: Path target ignores the patterns
- **WHEN** `memon --run-dir 'logs/*' run resolve-exp outputs/group/r-260901-090000` names an existing Run directory
- **THEN** the Run resolves even though the declared patterns would not discover it
