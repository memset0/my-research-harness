## ADDED Requirements

### Requirement: `memon experiment` subcommand family

The CLI SHALL expose `memon experiment` as a parent command with the
following subcommands. All write subcommands SHALL emit JSON status
objects on stdout (`{"ok":true, ...}`) on success and structured error
JSON on failure; all read subcommands SHALL default to JSON output and
support `--format human` for tabular output.

```
memon experiment ls          [--project-root <p>]
memon experiment show        <id-or-slug> [--project-root <p>]
memon experiment create      <slug> [--title <t>] [--hypotheses <H,H,...>]
                             [--from-run <run-dir>] [--project-root <p>]
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

The `id` argument SHALL accept either the canonical `E<NNNN>-<slug>`
form or the slug alone (when the slug uniquely identifies an
experiment). The `--run <run-dir>` option on `warning add` populates
the `Run` column of the new row; absence means the warning is
exp-scoped (rendered as `—`).

The `experiment create` command's behavior is detailed in the
`experiment-edit` capability; the `experiment link` / `unlink` /
`delete` commands' behaviors are detailed there as well.

The `experiment warning *` write commands SHALL:
- Use the section-bound writer for `## Warnings` defined in
  `experiment-readme`.
- Append a `[WARNING]` event to JOURNAL.md per write, including the
  `run` attribution.

#### Scenario: `experiment ls` returns JSON list
- **WHEN** the user runs `memon experiment ls --project-root <p>`
- **THEN** stdout is JSON `{"experiments": [...]}` with one entry per
  exp doc, including effective times computed from member runs

#### Scenario: `experiment warning add` requires a run for run-scoped
- **WHEN** the user runs `memon experiment warning add E0001 --run
  bar-260501-100000 --category result --message "..."`
- **THEN** the new row's `Run` cell is `bar-260501-100000`, the
  `[WARNING]` event has `run: "bar-260501-100000"`, and stdout is
  `{"ok":true,"rowId":"...","mtime":...}`

#### Scenario: `experiment warning add` without --run is exp-scoped
- **WHEN** the same command runs without `--run`
- **THEN** the new row's `Run` cell is `—`, the `[WARNING]` event has
  `run: null`

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

## MODIFIED Requirements

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
