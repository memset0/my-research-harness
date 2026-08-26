## ADDED Requirements

### Requirement: `memon run warning add` resolves the parent exp + dispatches

The CLI SHALL expose `memon run warning add <run-dir-or-id>
--category <cat> --message <text> [--note <n>]
[--expected-mtime <ms>] [--expected-hash <sha1>]
[--project-root <p>]`. The command SHALL:

1. Resolve the run dir from the argument (accepts either the bare
   run dir basename or the `id` field; same resolution as other
   run-side commands).
2. Read the run's `frontMatter.experiment` field.
3. If the field is null/empty, exit with error code `BAD_STATE`
   (resolves to exit 1 — `BAD_STATE` is the same code
   `memon run rename` uses for its own consistency-broken paths)
   and stderr message naming `memon experiment link` as the
   unblock command.
4. Otherwise dispatch internally to the same code path as
   `memon experiment warning add <exp> --run <run-dir>
   --category ... --message ...`. The output (stdout JSON +
   exit code + journal event) SHALL be byte-identical to the
   long form, so scripted callers can swap one for the other.

This command does NOT support the legacy "write to run README"
path. The convention is that warnings are exp-level, and an
orphan run cannot host one.

#### Scenario: Bound run dispatches to exp doc
- **GIVEN** a run `foo-260501-100000` with `experiment: E0001-foo`
- **WHEN** the user runs `memon run warning add foo-260501-100000
  --project-root . --category result --message "spike at step 1500"`
- **THEN** the warning row appears in
  `docs/experiments/E0001-foo.md`'s `## Warnings` table with
  `Run` column = `foo-260501-100000`; the JOURNAL gains a
  `[WARNING]` event with `\`E0001-foo\` op=add ... run=foo-260501-100000
  ...`; stdout is the same JSON shape as the long-form command;
  exit code is 0

#### Scenario: Orphan run is rejected
- **GIVEN** a run `bar-260501-100000` with no `experiment:` field
- **WHEN** the user runs `memon run warning add bar-260501-100000
  --project-root . --category result --message "..."`
- **THEN** the command exits with error code `BAD_STATE` (exit
  status 1), no filesystem write happens, and stderr names
  `memon experiment link` as the unblock command

#### Scenario: Unknown run id is rejected
- **WHEN** the user runs `memon run warning add nonexistent
  --project-root . --category result --message "..."`
- **THEN** the command exits 4 (`NOT_FOUND`); no filesystem write

### Requirement: `memon run resolve-exp` returns the parent exp id

The CLI SHALL expose `memon run resolve-exp <run-dir-or-id>
[--project-root <p>]`. The command SHALL print the run's parent
exp doc id to stdout as a single line (no JSON wrapper, no
trailing whitespace beyond a final newline). The command SHALL:

- Exit 0 with the exp id on stdout when the run is bound.
- Exit with `BAD_STATE` error code (exit status 1) and no stdout
  when the run exists but has no `experiment:` field; stderr
  carries the `ORPHAN_RUN`-prefixed message naming
  `memon experiment link` as the unblock command.
- Exit 4 (`NOT_FOUND`) with no stdout output and a stderr
  message when the run dir does not exist under the project
  root.

This is intentionally a one-line scalar output (rather than the
default JSON) so shell scripts can use the result inline:
`EXP=$(memon run resolve-exp $RUN --project-root .)`.

#### Scenario: Bound run prints exp id
- **GIVEN** a run `foo-260501-100000` with `experiment: E0001-foo`
- **WHEN** the user runs `memon run resolve-exp foo-260501-100000
  --project-root .`
- **THEN** stdout is exactly `E0001-foo\n`; exit code 0

#### Scenario: Orphan run exits BAD_STATE with empty stdout
- **GIVEN** a run `bar-260501-100000` with no `experiment:` field
- **WHEN** the user runs `memon run resolve-exp bar-260501-100000
  --project-root .`
- **THEN** stdout is empty; stderr names the orphan condition with
  `ORPHAN_RUN` and references `memon experiment link`; exit code
  is 1 (`BAD_STATE`)

#### Scenario: Unknown run exits 4
- **WHEN** the user runs `memon run resolve-exp nonexistent
  --project-root .`
- **THEN** stdout is empty; stderr names the NOT_FOUND condition;
  exit code is 4

### Requirement: `memon run` subcommand catalogue is documented

The CLI SHALL list the two new subcommands `warning add` and
`resolve-exp` in `memon run --help` output and in the README CLI
section, alongside the existing `archive` / `unarchive` /
`status set` / `readme write` / `rename`. The `warning add`
help text SHALL reference the long-form
`memon experiment warning add <exp> --run <run>` as the underlying
operation, and the orphan-refuse semantics SHALL be visible in
its `--help`.

#### Scenario: --help lists both new commands
- **WHEN** the user runs `memon run --help`
- **THEN** stdout's subcommand list includes `warning add` and
  `resolve-exp`
