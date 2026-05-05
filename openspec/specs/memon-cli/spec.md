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

`memon list` SHALL output all experiments across all configured projects, optionally filtered by `--project <name>`. The filter SHALL match against the experiment's top-level `project` field (set by discovery from the matching `config.yml` project's `name`). The filter SHALL NOT consult the experiment's front-matter `project:` field. The output is sorted by `created_at` descending.

#### Scenario: Filter by membership project (config-derived)
- **WHEN** the user runs `memon list --project sparse-fsdp` with `config.yml` declaring a project `sparse-fsdp` whose root contains 71 experiment dirs
- **THEN** all 71 experiments are returned, regardless of what each README's `frontMatter.project:` says

#### Scenario: --project does not match front-matter sub-project
- **GIVEN** an experiment whose `frontMatter.project` is `predictive-skip-validation` but which lives under config project `sparse-fsdp`
- **WHEN** the user runs `memon list --project predictive-skip-validation`
- **THEN** the experiment is NOT in the result set (no `config.yml` project named `predictive-skip-validation` exists; the filter does not fall back to front matter)
- **AND** when the user runs `memon search predictive-skip-validation`, the experiment IS surfaced (search matches both the top-level project and the front-matter sub-project)

#### Scenario: Implicit single-project mode
- **WHEN** the user runs `memon list` with `--project-root /mnt/p` (treating the path as one anonymous project) and the path contains 5 experiment directories
- **THEN** all 5 experiments are returned and their top-level `project` field is set to that anonymous project's name

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
- a `README.md` populated by a template (front matter prefilled, sections empty). The template's front matter SHALL include `project: <projectName>` as a default sub-project hint (matching the enclosing config project's name) — users are free to edit it later to a finer-grained recipe label.
- an executable `run.sh` template (referenced as `entry`)
- an entry appended to the project's `JOURNAL.md` with tag `[CREATE]`

#### Scenario: Successful creation
- **WHEN** the user runs `memon new attn-overlap` in a project with root `/mnt/p` (config project name `p`)
- **THEN** the directory `/mnt/p/logs/attn-overlap-260503-100000/` is created (timestamp = local now), `README.md` is written with `project: p` in its front matter, `run.sh` is written, and a `[CREATE]` event is appended to `/mnt/p/JOURNAL.md`

#### Scenario: Name collision in same second
- **WHEN** the user runs `memon new attn-overlap` and a directory with the resulting timestamp already exists
- **THEN** the command exits with a clear collision error and does not overwrite

#### Scenario: User edits sub-project after creation
- **GIVEN** a freshly-scaffolded experiment with `frontMatter.project: p` (the default)
- **WHEN** the user edits the README to set `project: attn-overlap-recipe`
- **THEN** subsequent `memon list --project p` still returns this experiment (top-level project unchanged), AND `memon search attn-overlap-recipe` surfaces it as a sub-project match

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

`memon experiment status set <id> --project-root <path> --to <STATUS> --expected-mtime <ms>` SHALL:
1. Read the experiment's README.md
2. Verify its mtime matches `--expected-mtime`; if not, exit 9 with `CONFLICT` and emit current content + mtime to stdout
3. Update the front-matter `status` field
4. Atomically write the new README (temp file + rename)
5. Append a `[STATUS]` event to JOURNAL.md if status actually changed

If the experiment has no README, the command SHALL exit 4 with `NOT_FOUND`.

#### Scenario: Successful status set
- **WHEN** the user runs `memon experiment status set foo-260501-100000 --project-root ./mock/project-a --to FINISHED --expected-mtime <current>`
- **THEN** README front-matter `status: FINISHED`; JOURNAL has a new `[STATUS]` event line; stdout `{"ok":true,"mtime":<new-mtime>,"prevStatus":"...","nextStatus":"FINISHED"}`; exit 0

#### Scenario: mtime conflict
- **WHEN** `--expected-mtime` is stale
- **THEN** exit 9 with stderr `{"error":{"code":"CONFLICT","message":"on-disk mtime differs"},"currentMtime":<n>,"currentContent":"<full readme>"}` and stdout = the current README content (so a skill can pipe it directly into a diff or re-decide); the file on disk is untouched

#### Scenario: Status unchanged → no JOURNAL event
- **WHEN** the requested status equals the current status
- **THEN** the README is rewritten (new mtime returned) but no JOURNAL event is appended; stdout has `journalAppended: false`

### Requirement: `memon experiment readme write` reads content from stdin

`memon experiment readme write <id> --project-root <path> --expected-mtime <ms> [--expected-hash <sha1>]` SHALL read the new README content from stdin (until EOF) and apply the same atomic-write + mtime-lock + JOURNAL-status-event protocol as `experiment status set`. If `--expected-hash` is provided and the on-disk content's sha1 differs, the command SHALL exit 9 with `CONFLICT` even when mtime matches (defends against low-resolution mtime on NFS).

#### Scenario: Successful overwrite
- **WHEN** the user pipes new content into `memon experiment readme write foo-260501-100000 --project-root ./mock/project-a --expected-mtime <current>`
- **THEN** the README is replaced atomically; if status changed, a `[STATUS]` event is appended; stdout `{"ok":true,"mtime":<new>,"journalAppended":true|false}`; exit 0

#### Scenario: Hash mismatch with matching mtime
- **WHEN** `--expected-mtime` matches but `--expected-hash` does not
- **THEN** exit 9 with `CONFLICT`; file unchanged

### Requirement: `memon experiment warning` subcommands

The CLI SHALL expose a `memon experiment warning` command group with the following subcommands:

```
memon experiment warning add <id>     --project-root <p> --category <cat> --message <text>
                                      [--expected-mtime <ms>] [--expected-hash <sha1>]
memon experiment warning list <id>    --project-root <p> [--status open|resolved|all]
memon experiment warning resolve <id> <rowId> --project-root <p> --note <text>
                                      [--expected-mtime <ms>] [--expected-hash <sha1>]
memon experiment warning reopen <id>  <rowId> --project-root <p> [--note <text>]
                                      [--expected-mtime <ms>] [--expected-hash <sha1>]
memon experiment warning delete <id>  <rowId> --project-root <p>
                                      [--expected-mtime <ms>] [--expected-hash <sha1>]
```

All write subcommands (`add`, `resolve`, `reopen`, `delete`) SHALL use the section-bound writer for `## Warnings` defined in the `experiment-readme` capability and SHALL append a `[WARNING]` event to `JOURNAL.md` describing the operation. Read subcommands (`list`) SHALL NOT modify any file. Output SHALL follow the existing `--format json|human` convention with JSON as default.

`add` SHALL generate `Created` from the system clock with timezone offset preserved (never UTC-normalised), generate a `rowId` of the form `w_<isoCreatedColonsToHyphens>_<4hex>`, and reject `--category` values outside the closed enum `{methodology, result, config, data, repro, compare, infra, other}` with exit 2 `BAD_REQUEST`.

`resolve` SHALL set `Status=RESOLVED`, `Resolved=<now-ISO with offset>`, and `Note=<--note>`. The `--note` flag SHALL be required for `resolve`. `reopen` SHALL set `Status=OPEN`, clear `Resolved` and `Note`, and preserve `Created`.

`delete` SHALL remove the row from the table; the JOURNAL event SHALL include the deleted row's complete content for reversibility.

#### Scenario: add appends a row and emits structured stdout
- **WHEN** the user runs `memon experiment warning add foo-260501 --project-root . --category result --message "loss spike at step 1500"`
- **THEN** stdout is `{"ok":true,"rowId":"w_2026-05-05T14-32-00+0800_a3f1","mtime":<new>}`, the `## Warnings` section in the README contains the new row, and JOURNAL.md has a new `[WARNING]` event with `op=add`

#### Scenario: list filters by status
- **GIVEN** a README with two OPEN rows and one RESOLVED row
- **WHEN** the user runs `memon experiment warning list foo-260501 --project-root . --status open`
- **THEN** stdout is a JSON array of length 2 containing only the OPEN rows, each carrying its `rowId`, `category`, `message`, `created`, `resolved`, and `note`

#### Scenario: resolve requires --note
- **WHEN** the user runs `memon experiment warning resolve foo-260501 w_xxx --project-root .` (no `--note`)
- **THEN** the command exits 2 with `BAD_REQUEST` and a stderr message naming the missing flag

#### Scenario: Unknown category rejected
- **WHEN** the user runs `memon experiment warning add foo-260501 --project-root . --category aesthetic --message "..."`
- **THEN** the command exits 2 `BAD_REQUEST` with a stderr message listing the accepted enum values; the README is not modified

#### Scenario: rowId not found
- **WHEN** the user runs `memon experiment warning resolve foo-260501 w_does_not_exist --project-root . --note "..."`
- **THEN** the command exits 4 `NOT_FOUND` and the README is not modified

#### Scenario: CONFLICT on stale expected-mtime
- **WHEN** any write subcommand is invoked with `--expected-mtime` older than the current on-disk mtime AND the warnings section was edited in between
- **THEN** the command exits 9 `CONFLICT` and the stderr JSON includes the current mtime + content so the caller can retry

#### Scenario: delete preserves audit trail in JOURNAL
- **GIVEN** a row `w_xxx` with category `result` and a non-trivial message
- **WHEN** the user runs `memon experiment warning delete foo-260501 w_xxx --project-root .`
- **THEN** the row is removed from the table AND JOURNAL.md has a new `[WARNING]` event with `op=delete` whose body contains the deleted row's full content

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

### Requirement: `memon experiment archive` toggles the `.archived` sidecar

`memon experiment archive <id> --project-root <p>` SHALL create an empty file at `<runDir>/.archived`. `memon experiment unarchive <id> --project-root <p>` SHALL remove that file (or no-op if it doesn't exist). Both commands SHALL append a single `[ARCHIVE]` event to JOURNAL.md (body: `\`<id>\` archived` or `\`<id>\` unarchived`). Neither command SHALL modify README.md or its mtime.

#### Scenario: Archive a run
- **WHEN** the user runs `memon experiment archive foo-260501-100000 --project-root ./mock/project-a`
- **THEN** `<runDir>/.archived` exists (size 0)
- **AND** README.md mtime is unchanged
- **AND** JOURNAL.md has a new `[ARCHIVE]` event line for that id
- **AND** stdout is `{"ok":true,"archived":true}`; exit 0

#### Scenario: Unarchive
- **WHEN** the user runs `memon experiment unarchive foo-260501-100000 --project-root ./mock/project-a` after a previous archive
- **THEN** `<runDir>/.archived` is gone, README.md mtime unchanged, JOURNAL appended with an unarchive note; stdout `{"ok":true,"archived":false}`

#### Scenario: Unarchive a non-archived run
- **WHEN** unarchive is called on a run that has no `.archived` sidecar
- **THEN** the command exits 0 with `{"ok":true,"archived":false,"noop":true}` and does NOT write a JOURNAL event

### Requirement: Read commands honor archive filter via `--include-archived`

`list` / `scan` / `show` / `search` / `journal read` / `hypo list` / `hypotheses read` / `doctor` SHALL skip experiments whose run directory contains `.archived` by default. A `--include-archived` flag SHALL include them. An `--archived-only` flag SHALL include only archived runs (useful for digest / cleanup workflows).

#### Scenario: list excludes archived by default
- **WHEN** the user archives `foo-260501-100000` then runs `memon list --project-root ./mock/project-a`
- **THEN** `foo-260501-100000` is NOT in the output

#### Scenario: list --include-archived
- **WHEN** the user runs `memon list --project-root ./mock/project-a --include-archived`
- **THEN** archived runs are present in the output, each with an `archived: true` field on the experiment record

#### Scenario: --archived-only
- **WHEN** the user runs `memon list --project-root ./mock/project-a --archived-only`
- **THEN** only archived runs are returned

### Requirement: `memon doctor` reports incomplete-state issues without writing

`memon doctor --project-root <p> [--include-archived] [--severity <min>]` SHALL scan the project root, run a fixed set of consistency rules, and emit an issue list. The command SHALL NOT modify any file on disk. Exit code SHALL reflect the highest severity present: `0` when no issues or only `info`/`warn`; `1` when at least one `error` issue is reported. The `--severity` flag (default `info`) filters issues at or above that level.

The rule set v1:

| `code` | `severity` | trigger |
|---|---|---|
| `MISSING_RESULT` | `warn` | `status === 'FINISHED'` and `sections.result` is missing or only whitespace |
| `MISSING_CONCLUSION` | `warn` | `status === 'FINISHED'` and `sections.conclusion` missing |
| `FAILED_NO_NOTE` | `info` | `status === 'FAILED'` and `sections.result` is empty |
| `STALE_RUNNING` | `info` | `status === 'RUNNING'` and `isStaleRunning` returns true |
| `PARSE_ERROR` | `error` | `parseErrors.length > 0` |
| `PARSE_WARNING` | `warn` | `parseWarnings.length > 0` |
| `ORPHAN_HYPOTHESIS_REF` | `warn` | front matter `hypotheses[]` contains an id NOT present in HYPOTHESES.md `entries[].id` |

Output shape:

```jsonc
{
  "scannedAt": "<ISO>",
  "projectRoot": "<abs>",
  "issues": [
    { "experimentId", "code", "severity", "message", "suggestedAction" }
  ],
  "summary": {
    "total": <n>,
    "byCode":     { "MISSING_RESULT": <n>, ... },
    "bySeverity": { "error": <n>, "warn": <n>, "info": <n> }
  }
}
```

#### Scenario: FINISHED run with empty Result
- **GIVEN** an experiment whose front matter has `status: FINISHED` and whose `## Result` section is missing
- **WHEN** the user runs `memon doctor --project-root <p>`
- **THEN** the issues array contains one entry with `code: "MISSING_RESULT"` for that experiment id

#### Scenario: PARSE_ERROR triggers exit 1
- **GIVEN** at least one experiment whose README has a parse error
- **WHEN** the user runs `memon doctor`
- **THEN** the issue list contains a `severity: "error"` entry and the command exits with code 1

#### Scenario: Doctor ignores archived runs by default
- **GIVEN** an archived FINISHED experiment with empty Result
- **WHEN** `memon doctor` runs without `--include-archived`
- **THEN** that experiment does NOT appear in the issues array

#### Scenario: --severity filter
- **WHEN** the user runs `memon doctor --severity warn`
- **THEN** issues with `severity: "info"` are filtered out of the output (but still counted in `summary.bySeverity`)

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

