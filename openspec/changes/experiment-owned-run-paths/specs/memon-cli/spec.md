## MODIFIED Requirements

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
