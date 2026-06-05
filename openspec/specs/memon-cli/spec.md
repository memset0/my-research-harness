# memon-cli Specification

## Purpose
TBD - created by archiving change add-memon-mvp. Update Purpose after archive.
## Requirements
### Requirement: Single binary `memon` with subcommands

The package SHALL expose a single CLI binary `memon` (registered via
`package.json` `bin`) with subcommands: `serve`, `list`, `show`,
`search`, `new`, `hypo`, `mock`, `experiment`, `run`, `doctor`,
`scan`, `journal`, `hypotheses`, `install-skills`, `fs-version`.
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
  including `experiment` and `run`, exit code 0

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

### Requirement: Config resolution order

For all **non-`serve`, non-`notify`** subcommands, the system SHALL
resolve the project context in this order:
1. **`--project-root <path>`** (when present, treats the path as a
   single anonymous project)
2. **Implicit cwd** — when `--project-root` is absent,
   `process.cwd()` is treated as a single anonymous project's root

There SHALL be no `<cwd>/config.yml` lookup and no `--config <path>`
flag for these subcommands. `loadCliContext` in `@memon/core` SHALL
accept only `projectRoot` and `cwd` in its input; its `source` field
SHALL be one of `'project-root' | 'implicit-cwd'`.

For `memon serve`, configuration resolution is handled within the
`serve` subcommand itself (see "memon serve" requirement above) and
SHALL look at the explicit `--config <path>`, then `<cwd>/config.yml`,
then `<repo-root>/config.yml`.

For `memon notify <severity>` and `memon notify test`, credentials
SHALL resolve in this precedence (highest → lowest):
1. **Env vars** — both `MEMON_TELEGRAM_BOT_TOKEN` and
   `MEMON_TELEGRAM_CHAT_ID` set and non-empty.
2. **`config.yml` `telegram:` block** — at the path specified by
   `--config <path>` (when given), else at `<cwd>/config.yml`.
3. **Neither** — exit `BAD_REQUEST` (code 2) with a hint naming both
   sources.

`notify` is the only non-`serve` subcommand that reads `config.yml`,
and it does so only to read the `telegram:` block (it does NOT read
`projects`, `auth`, `poll`, `terminal`, `slurm`, or `gitStatus`).

`--project-root` is mutually exclusive with `--project NAME`;
combining them SHALL exit 2 with a `BAD_REQUEST` error. (`--config` is
not a global flag — it is a per-subcommand option valid only on
`serve` and `notify`.) `memon notify` SHALL reject `--project-root` /
`--project` outright (it has no notion of a project context).

#### Scenario: --project-root takes precedence

- **WHEN** the user runs `memon list --project-root /a` from a
  directory that also contains a `config.yml`
- **THEN** `/a` is used as the project root and the cwd `config.yml`
  is NOT read (the CLI does not look at it)

#### Scenario: Implicit cwd-as-project for `list`

- **WHEN** the user runs `memon list` with no `--project-root` from
  inside `/some/project-dir`
- **THEN** the command treats `/some/project-dir` as the single
  anonymous project's root and proceeds; no `config.yml` lookup
  happens

#### Scenario: `serve` without any config

- **WHEN** the user runs `memon serve` without `--config` and no
  `config.yml` in cwd or repo root
- **THEN** the command exits with a structured error explaining how
  to create `config.yml`. (Note: `memon serve` does NOT support
  `--project-root` since the web stack requires the full config
  schema for multi-project setups.)

#### Scenario: `notify` env vars win over config.yml

- **GIVEN** `<cwd>/config.yml` declares
  `telegram.chat_id: "-100A"` and the env vars are set with
  `MEMON_TELEGRAM_CHAT_ID="-100B"`
- **WHEN** the user runs `memon notify info "..."` from `<cwd>`
- **THEN** the outgoing request targets chat `-100B`

#### Scenario: `notify` falls back to config.yml when env vars absent

- **GIVEN** no env vars are set and `<cwd>/config.yml` declares a
  full `telegram:` block
- **WHEN** the user runs `memon notify info "..."` from `<cwd>`
- **THEN** the credentials are read from `<cwd>/config.yml` and the
  request succeeds

#### Scenario: `notify` exits `BAD_REQUEST` when no credentials anywhere

- **GIVEN** no env vars AND no `telegram:` block in any reachable
  `config.yml`
- **WHEN** the user runs `memon notify info "..."`
- **THEN** stderr `BAD_REQUEST` envelope names both
  `MEMON_TELEGRAM_BOT_TOKEN`+`MEMON_TELEGRAM_CHAT_ID` and the
  `telegram:` block; exit `2`

### Requirement: Default JSON output, `--format human` for human

All read subcommands (`list`, `show`, `search`, `hypo list`, `hypo show`, **`scan`**, **`hypotheses read`**, **`journal read`**) SHALL default to machine-readable JSON output on stdout to support agent consumption. A `--format human` flag SHALL switch to a tabular/colored human-readable rendering.

Write subcommands (`experiment status set`, `experiment readme write`, `journal append`, `journal digest-mark`) SHALL emit JSON status objects on stdout (`{"ok":true,...}` on success, structured error JSON on failure). They SHALL NOT have a `--format human` mode in v1; their output is intended for skill consumption.

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

### Requirement: `memon new <name>` creates an experiment scaffold

`memon new <name>` SHALL create a new **run** directory at
`<projectRoot>/logs/<name>-<yymmdd>-<hhmmss>/` (using current local time)
with:
- a `README.md` populated by the v3 run template (frontmatter
  prefilled, `Setup` / `Result` / `Artifacts` sections empty). The
  template's frontmatter SHALL include `created_at` (now), `updated_at`
  (= `created_at`), and SHALL leave `experiment:` empty for the agent
  / user to fill in.
- an executable `run.sh` template (referenced as `entry`)
- an entry appended to JOURNAL.md with tag `[CREATE]`

The template SHALL NOT include `project:` (sub-project) or run-level
`hypotheses:` / `tags:` (those moved to the experiment layer).

#### Scenario: Successful creation
- **WHEN** the user runs `memon new attn-overlap` in a project with
  root `/mnt/p` (config project name `p`)
- **THEN** the directory `/mnt/p/logs/attn-overlap-260503-100000/` is
  created, `README.md` has v3 frontmatter (no `project:`, no
  `hypotheses:`, no `tags:`), `run.sh` is written, and a `[CREATE]`
  event is appended to JOURNAL.md

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

### Requirement: `memon scan <project-root>` returns the full project snapshot

`memon scan <project-root>` SHALL output a single JSON document containing every structured piece of state under that project root: experiments (with full parsed sections), hypotheses, journal events. The output shape SHALL match this contract exactly so callers can parse it without conditionals:

```jsonc
{
  "projectRoot": "<abs path>",
  "scannedAt":   "<ISO8601 with offset>",
  "experiments": [
    { "id", "path", "mtime", "hasReadme", "frontMatter", "sections", "parseErrors": [], "parseWarnings": [], "stale" }
  ],
  "hypotheses": { "legendBlock", "summaryTableBlock", "entries": [...], "parseErrors": [], "parseWarnings": [] },
  "journal":    { "lastDigestAt", "events": [...] }
}
```

Default JSON; `--format human` SHALL emit a tabular human summary.

#### Scenario: Scan a populated project
- **WHEN** the user runs `memon scan ./mock/project-a`
- **THEN** stdout is JSON with `experiments.length === 5` (matching the fixture), `hypotheses.entries.length === 6`, `journal.events.length > 0`; exit 0

#### Scenario: Scan an empty project root
- **WHEN** the user runs `memon scan /tmp/empty-dir` where the dir exists but has no experiment subdirs and no HYPOTHESES/JOURNAL
- **THEN** stdout is JSON with `experiments: []`, `hypotheses: { entries: [], summaryTableBlock: null, ... }`, `journal: { lastDigestAt: null, events: [] }`; exit 0

#### Scenario: Scan output JSON shape matches the web `/api/scan` if implemented
- **WHEN** any consumer parses the output of `memon scan`
- **THEN** field names and types are identical to what the web backend returns at `/api/scan` (or would return if the web `scan` route were implemented identically — same Zod schema)

### Requirement: `memon journal append` is the only path for non-STATUS events

`memon journal append --project-root <path> --tag <TAG> --body <BODY> [--experiment-id <id>] [--at <ISO>]` SHALL append a single event line to `<projectRoot>/JOURNAL.md`. The command SHALL NOT touch the file's frontmatter, including `last_digest_at`. Allowed tags: `NOTE` / `REQUEST` / `ERROR` / `ARCHIVE` / `CREATE`. The tag `STATUS` SHALL be rejected with `BAD_REQUEST` — STATUS events are emitted automatically by `memon experiment status set`.

#### Scenario: Append a NOTE
- **WHEN** the user runs `memon journal append --project-root ./mock/project-a --tag NOTE --body "agent observation" --experiment-id foo-260501-100000`
- **THEN** the JOURNAL gains exactly one new line `- <ISO> [NOTE] \`foo-260501-100000\` agent observation`
- **AND** the file's frontmatter `last_digest_at` is unchanged
- **AND** stdout is `{"ok":true,"appended":1,"timestamp":"<ISO>"}`; exit 0

#### Scenario: Reject STATUS tag
- **WHEN** the user runs `memon journal append ... --tag STATUS --body "..."`
- **THEN** the command exits 2 with stderr `{"error":{"code":"BAD_REQUEST","message":"STATUS events must be emitted via 'memon experiment status set'"}}`
- **AND** the JOURNAL is untouched

#### Scenario: Project root has no JOURNAL.md yet
- **WHEN** the user runs `journal append` on a fresh project root with no JOURNAL.md
- **THEN** the command creates JOURNAL.md with a frontmatter `last_digest_at: null` block and appends the event line; exit 0

### Requirement: `memon journal digest-mark` is the only path that updates `last_digest_at`

`memon journal digest-mark --project-root <path> --at <ISO>` SHALL atomically update the `last_digest_at` field in `<projectRoot>/JOURNAL.md` frontmatter to the given timestamp. The command SHALL NOT modify any event lines. The command SHALL be the only CLI entrypoint that mutates frontmatter (concretely: only path that calls `updateLastDigestAt` from `@memon/core`).

#### Scenario: Update last_digest_at
- **WHEN** the user runs `memon journal digest-mark --project-root ./mock/project-a --at 2026-05-04T10:00:00+08:00`
- **THEN** JOURNAL.md frontmatter shows `last_digest_at: 2026-05-04T10:00:00+08:00`
- **AND** all event lines below the frontmatter are byte-identical to before
- **AND** stdout is `{"ok":true,"lastDigestAt":"2026-05-04T10:00:00+08:00"}`; exit 0

#### Scenario: Invalid ISO timestamp
- **WHEN** `--at` is not a valid ISO8601 string with offset
- **THEN** exit 2 with `BAD_REQUEST`

### Requirement: `memon journal read` exposes paged query

`memon journal read --project-root <path> [--since <ISO>] [--tag <TAG>] [--experiment-id <id>] [--limit <N>]` SHALL parse the project's JOURNAL.md and emit `{"events":[...],"lastDigestAt":"..."}`. Filters compose AND-style. Default `--limit` is 200, max 1000.

#### Scenario: Filter by tag and experiment
- **WHEN** the user runs `memon journal read --project-root ./mock/project-a --tag NOTE --experiment-id foo-260501-100000`
- **THEN** only events whose tag is `NOTE` and whose experimentId matches are returned

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
- **AND** JOURNAL has a `[EXP_STATUS] OPEN → RESOLVED` line
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

`delete` SHALL remove the row; the JOURNAL event SHALL include the
deleted row's complete content for reversibility.

#### Scenario: add with run attribution
- **WHEN** the user runs `memon experiment warning add E0001-foo --run
  bar-260501-100000 --category result --message "..."`
- **THEN** stdout is `{"ok":true,"rowId":"...","mtime":...}`, the `##
  Warnings` table on the exp doc has the new row with Run cell
  `bar-260501-100000`, and JOURNAL has a `[WARNING]` event with
  `run: "bar-260501-100000"`

#### Scenario: add without --run is exp-scoped
- **WHEN** the same command runs without `--run`
- **THEN** the new row's Run cell is `—`, the JOURNAL event has
  `run: null`

### Requirement: `WARN_UNRESOLVED` doctor code

`memon doctor`'s rule set SHALL include a code `WARN_UNRESOLVED` (severity `info`) that triggers when an experiment has at least one warning row with `Status=OPEN`. The issue payload SHALL include a `count` field with the number of open warnings on that experiment so the consumer can order or filter by noise.

The code SHALL NOT cause exit code 1 (`info` severity does not bump the exit code per the existing severity rules). The `--severity warn` filter SHALL exclude `WARN_UNRESOLVED` from output but it SHALL still appear in `summary.byCode`.

#### Scenario: Open warning surfaces WARN_UNRESOLVED
- **GIVEN** an experiment whose `## Warnings` table contains at least one row with `Status=OPEN`
- **WHEN** the user runs `memon doctor --project-root .`
- **THEN** the issues array contains a `WARN_UNRESOLVED` entry for that experiment with `severity: "info"` and a `count` reflecting the number of open warnings

#### Scenario: All RESOLVED suppresses WARN_UNRESOLVED
- **GIVEN** an experiment whose `## Warnings` table contains only RESOLVED rows
- **WHEN** `memon doctor` runs
- **THEN** no `WARN_UNRESOLVED` issue is emitted for that experiment

#### Scenario: WARN_UNRESOLVED does not bump exit code
- **GIVEN** a project where every doctor finding is `WARN_UNRESOLVED`
- **WHEN** `memon doctor` runs
- **THEN** the command exits 0 (info-only severities do not bump exit code per existing rules)

### Requirement: `memon experiment archive` toggles the `archived` frontmatter field

`memon experiment archive <id> --project-root <p>` SHALL set `archived: true` on the target's frontmatter (an exp doc when `<id>` matches `EXPERIMENT_FILENAME_REGEX`, a run README when `<id>` matches `RUN_DIR_REGEX` — the run-id form is a deprecation alias for `memon run archive`). `memon experiment unarchive <id> --project-root <p>` SHALL set `archived: false`. Both commands SHALL append a single `[ARCHIVE]` event to JOURNAL.md per `archive-frontmatter`'s "Archive subcommands write frontmatter atomically with mtime-lock + JOURNAL [ARCHIVE] event." Both SHALL bump the README / doc `updated_at` (the v3 wording "Neither command SHALL modify README.md or its mtime" no longer applies — the archive write IS a frontmatter mutation in v4).

The hard `archive-on-RUNNING` rule applies to the run-id form (or to a run-targeting `archive` command). The soft warning applies when archiving an already-archived target (no-op success with the warning suppressed per `archive-frontmatter`'s unarchive-doesn't-warn rule on the unarchive side).

#### Scenario: Archive a run via deprecation alias writes frontmatter
- **WHEN** the user runs `memon experiment archive foo-260513-100000 --project-root <p>` (run-id form)
- **THEN** stderr contains `[deprecation]` banner pointing to `memon run archive`
- **AND** the run's README has `archived: true` in frontmatter
- **AND** JOURNAL has a new `[ARCHIVE] \`foo-260513-100000\` op=archive` line
- **AND** README `updated_at` is bumped
- **AND** there is NO `<runDir>/.archived` sidecar created (the legacy mechanism is gone)

#### Scenario: Archive an exp doc writes frontmatter
- **WHEN** the user runs `memon experiment archive E0001-zero-snr-fix --project-root <p>` (exp-id form)
- **THEN** the doc's frontmatter has `archived: true`
- **AND** JOURNAL has a new `[ARCHIVE] \`E0001-zero-snr-fix\` op=archive` line

#### Scenario: Archive a RUNNING run is refused
- **GIVEN** a run with `status: RUNNING`
- **WHEN** the user runs `memon experiment archive <run-id>` or `memon run archive <run-id>`
- **THEN** the command exits 2 with `{"error":{"code":"BAD_REQUEST","message":"cannot archive a RUNNING run; set status to INTERRUPTED, FINISHED, or FAILED first"}}`

### Requirement: Read commands honor archive filter via `--include-archived`

`list` / `scan` / `show` / `search` / `journal read` / `hypo list` / `hypotheses read` / `doctor` SHALL skip experiments AND runs whose `archived: true` (per the frontmatter field, NOT the legacy sidecar) by default. A `--include-archived` flag SHALL include them. An `--archived-only` flag SHALL include only items with `archived: true`.

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

### Requirement: `memon doctor` reports incomplete-state issues without writing

`memon doctor --project-root <p> [--include-archived] [--severity <min>]` SHALL scan the project root, run a fixed set of consistency rules, and emit an issue list. The command SHALL NOT modify any file on disk. Exit code SHALL reflect the highest severity present: `0` when no issues or only `info`/`warn`; `1` when at least one `error` issue is reported. The `--severity` flag (default `info`) filters issues at or above that level.

The rule set v4 (additions to v3 marked):

| `code` | `severity` | trigger |
|---|---|---|
| `MISSING_RESULT` | `warn` | `status === 'FINISHED'` and `sections.result` is missing or only whitespace |
| `MISSING_CONCLUSION` | `warn` | `status === 'FINISHED'` and `sections.conclusion` missing |
| `FAILED_NO_NOTE` | `info` | `status === 'FAILED'` and `sections.result` is empty |
| `INTERRUPTED_NO_NOTE` | `info` | (v4-added) `status === 'INTERRUPTED'` and `sections.result` is empty (whitespace-only counts as empty) |
| `RESOLVED_NO_CONCLUSION` | `info` | (v4-added) exp doc with `status === 'RESOLVED'` and `sections.conclusion` is empty |
| `STALE_RUNNING` | `info` | `status === 'RUNNING'` and `isStaleRunning` returns true |
| `PARSE_ERROR` | `error` | `parseErrors.length > 0` |
| `PARSE_WARNING` | `warn` | `parseWarnings.length > 0` |
| `ORPHAN_HYPOTHESIS_REF` | `warn` | front matter `hypotheses[]` contains an id NOT present in HYPOTHESES.md `entries[].id` |
| `LEGACY_ARCHIVE_SIDECAR` | `info` | (v4-added; emitted via parse-warning bubbling) run README lacks `archived` frontmatter and a `<runDir>/.archived` sidecar exists; instructs the user to re-run migration or set the field manually |

The doctor SHALL NOT add lints that depend on the soft warning emitted at write time by `archive-frontmatter` — the soft warning is a write-time signal, not a static lint.

The doctor SHALL NOT add a lint for `ABANDONED` exp without `## Caveats` in v4; tentatively unnecessary, can be added later if user feedback supports it.

#### Scenario: INTERRUPTED with empty Result triggers info lint
- **GIVEN** a run with `status: INTERRUPTED` and `## Result` section is missing or only whitespace
- **WHEN** the user runs `memon doctor --project-root .`
- **THEN** the issues array contains a `INTERRUPTED_NO_NOTE` entry with `severity: 'info'`
- **AND** the exit code is 0 (info severity does not bump exit code per existing rules)

#### Scenario: RESOLVED exp without Conclusion triggers info lint
- **GIVEN** an exp doc with `status: RESOLVED` and `## Conclusion` is empty
- **WHEN** the user runs `memon doctor --project-root .`
- **THEN** the issues array contains a `RESOLVED_NO_CONCLUSION` entry with `severity: 'info'`

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

### Requirement: Optional cross-process scan cache (deferred — contract only)

The CLI and web backend SHALL respect the env var `MEMON_SCAN_CACHE`: when **unset or `0`** the system SHALL behave as if no on-disk scan cache exists (this is the v1 default — no cache implementation lives in this change). When set to `1`, both surfaces SHALL read and write a snapshot file at `~/.cache/memon/scan/<sha1(absoluteProjectRoot)>/snapshot.json` according to the contract below. **v1 of `add-skills-cli` does not implement the `=1` branch** — this Requirement freezes the format so a future change can flip the switch without renegotiating the spec.

- **Location**: cache files SHALL live at `~/.cache/memon/scan/<sha1(absoluteProjectRoot)>/snapshot.json`
- **Snapshot shape** (writers MUST emit, readers MUST tolerate exactly this shape):
  ```jsonc
  {
    "schemaVersion": 1,
    "projectRoot": "<abs>",
    "writtenAt": "<ISO with offset>",
    "experiments": [{ "id", "path", "mtimeMs", "size" }, ...],
    "hypothesesMtimeMs": <n|null>,
    "journalMtimeMs":    <n|null>,
    "snapshot": { /* full `memon scan` output */ }
  }
  ```
- **Validation**: on a cache hit, consumers SHALL re-`fs.stat` every entry in `experiments[].path`, `HYPOTHESES.md`, `JOURNAL.md`. Any mtime mismatch SHALL invalidate the entire snapshot; the consumer MUST then fall back to a full rescan and overwrite the snapshot.
- **Atomic write**: writers MUST use `snapshot.json.tmp.<rand>` followed by `rename`; partial writes are forbidden.
- **Cross-process safety**: concurrent writers may race the rename — the loser SHALL accept the winner's snapshot without retrying (the next consumer re-validates freshness regardless).
- **Disposability**: deleting `~/.cache/memon/scan/` MUST never cause data loss; it only forces a rescan.

#### Scenario: Cache off (v1 default)
- **WHEN** `MEMON_SCAN_CACHE` is unset or `=0`
- **THEN** every `memon scan` invocation walks the project root from scratch; no file in `~/.cache/memon/scan/` is created or read

#### Scenario: Cache hit (future)
- **WHEN** `MEMON_SCAN_CACHE=1` AND a snapshot exists for this root AND every recorded mtime still matches the on-disk file
- **THEN** the command returns the cached `snapshot` field directly without walking the tree (target latency < 50ms for a 200-experiment project)

#### Scenario: Cache miss due to mtime drift (future)
- **WHEN** `MEMON_SCAN_CACHE=1` AND a snapshot exists but at least one tracked path's mtime has changed
- **THEN** the cache is treated as missing; a full rescan runs and overwrites the snapshot atomically

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
memon experiment ls          [--project-root <p>]
memon experiment show        <id-or-slug> [--project-root <p>]
memon experiment create      <slug> [--title <t>] [--hypotheses <H,H,...>]
                             [--from-run <run-dir>] [--project-root <p>]
memon experiment rename      <id-or-slug> <new-slug> [--project-root <p>]
memon experiment link        <id> <run-dir-or-id> [--project-root <p>]
memon experiment unlink      <id> <run-dir-or-id> [--project-root <p>]
memon experiment delete      <id> [--force] [--project-root <p>]
memon experiment warning add     <id> [--run <run-dir>] --category <cat>
                                  --message <text> [--expected-mtime <ms>]
                                  [--expected-hash <sha1>]
memon experiment warning resolve <id> <rowId> --note <text>
                                  [--expected-mtime <ms>] [--expected-hash <sha1>]
memon experiment warning reopen  <id> <rowId> [--note <text>]
                                  [--expected-mtime <ms>] [--expected-hash <sha1>]
memon experiment warning delete  <id> <rowId>
                                  [--expected-mtime <ms>] [--expected-hash <sha1>]
memon experiment warning list    <id> [--status open|resolved|all]
```

The `id` argument SHALL accept either the canonical `E<NNNN>-<slug>` form or the slug alone (when the slug uniquely identifies an experiment). The `--run <run-dir>` option on `warning add` populates the `Run` column of the new row; absence means the warning is exp-scoped (rendered as `—`).

The `experiment create` and `experiment rename` commands' behaviors are detailed in the `experiment-edit` capability; the `experiment link` / `unlink` / `delete` commands' behaviors are detailed there as well.

The `experiment warning *` write commands SHALL:
- Use the section-bound writer for `## Warnings` defined in `experiment-readme`.
- Append a `[WARNING]` event to JOURNAL.md per write, including the `run` attribution.

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
- `run rename` updates the parent experiment's `runs[]` array
  atomically.

#### Scenario: `run ls` returns JSON list
- **WHEN** the user runs `memon run ls --project-root <p>`
- **THEN** stdout is `{"runs": [...]}` with one entry per run dir,
  including the parent `experiment` field when set

#### Scenario: `run rename` updates parent exp atomically
- **WHEN** a run with `experiment: E0001-foo` is renamed via `memon run
  rename`
- **THEN** the corresponding `E0001-foo.runs[]` entry is updated to the
  new dir name in the same operation; both files are atomically
  consistent post-command

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
- **AND** the JOURNAL `[WARNING]` event carries `` `E0001-foo` op=add ... run=bar-260501-100000 ... ``
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
- **AND** no JOURNAL event is appended

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

### Requirement: `memon notify` subcommand family

The CLI SHALL gain a new top-level subcommand `memon notify` with two
children:

- `memon notify <severity> "<title>" [--details D | --details-file P]
  [--context K=V]... [--link URL] [--agent KIND] [--session NAME]
  [--soft] [--quiet] [--format human|json] [--config <path>]`
- `memon notify test [--format human|json] [--config <path>]`

`--details-file <path>` accepts `-` to mean stdin (consistent with the
existing `memon experiment readme write` stdin convention). `--details`
and `--details-file` are mutually exclusive.

Severity SHALL be one of the five lowercase tokens `info`, `warn`,
`error`, `question`, `done`. Full behavior is specified in the
`telegram-notify` capability spec. This requirement establishes the
CLI surface shape:

- The subcommands SHALL be registered in
  `packages/cli/src/commands/notify.ts` and exposed from the main
  `memon` binary via the standard subcommand dispatch in
  `packages/cli/src/index.ts`.
- Default output format SHALL be `json`; `--format human` switches to
  a one-line status (`sent → @<chat-id> (#<message_id>)` on success).
- Exit codes follow the existing dictionary: `0` success, `1` runtime
  error (network / Telegram 4xx-5xx), `2` usage error (unknown
  severity, missing title, missing config).
- The subcommands SHALL resolve Telegram credentials independently of
  the standard `--project-root` / cwd-as-project resolver — `memon
  notify` does NOT take `--project-root`. Credential resolution is
  fully specified by the `telegram-notify` capability.
- The `--soft` flag suppresses non-zero exit on send failure (the
  structured error is still printed to stderr, but exit is `0`). This
  is the agent-friendly mode: a transient Telegram outage MUST NOT
  block the calling agent. `notify test` does NOT honor `--soft`.
- The bot token SHALL NEVER appear on stdout or stderr (including on
  401 from Telegram, where the error envelope SHALL read `401
  Unauthorized: token rejected`).

#### Scenario: `memon notify error` JSON output on success

- **GIVEN** valid Telegram credentials are available via `config.yml`
- **WHEN** the user runs `memon notify error "training crashed"
  --details "step 1500 timeout" --context project=sparse-fsdp
  --agent claude --session telegram-notify`
- **THEN** stdout is JSON `{"sent": true, "severity": "error", "title":
  "training crashed", "agent": "claude", "session":
  "telegram-notify", "telegram_chat_id": "<id>",
  "telegram_message_id": <int>}`; exit code `0`

#### Scenario: Unknown severity is a usage error

- **WHEN** the user runs `memon notify oops "msg"`
- **THEN** the CLI exits with code `2` and stderr names the five
  valid severities; no network request is made

#### Scenario: `memon notify --soft` exits zero on telegram failure

- **GIVEN** the Telegram API returns `500 Internal Server Error`
- **WHEN** the user runs `memon notify error "x" --soft`
- **THEN** stderr contains the structured error envelope but exit is
  `0`

#### Scenario: `memon notify test` self-check

- **WHEN** the user runs `memon notify test` with valid credentials
- **THEN** a canary message arrives in the configured chat, stdout
  is JSON `{"sent": true, ...}`, exit `0`

#### Scenario: `memon notify` does NOT take `--project-root`

- **WHEN** the user runs `memon notify info "x" --project-root /tmp`
- **THEN** the command parser rejects the unknown option with a
  non-zero exit (commander's standard "unknown option" error); the
  same happens for `--project <name>`

