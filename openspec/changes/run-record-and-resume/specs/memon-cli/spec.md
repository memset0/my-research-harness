## MODIFIED Requirements

### Requirement: `memon run` subcommand family

The CLI SHALL expose `memon run` as a parent command with the following
subcommands. The behavior of `memon run rename` is detailed in the
`run-edit` capability; `create`, `launch`, `resume`, `stop`, `reconcile`
and `progress` are detailed in the `run-launch` capability; `result` is
detailed in `run-results`.

```
memon run ls                 [--project-root <p>] [--include-archived]
memon run show               <id-or-slug> [--project-root <p>]
memon run create             <slug> --command <text> [--at <run-location>] [--entry <path>]
                             [--target-steps <n>] [--gpus <n>] [--checkpoint-dir <path>]
                             [--progress-checkpoints] [--resumable] [--wandb-id <id>|auto]
                             [--priority <n>] [--preemptible --preemptible-reason <text>]
memon run record             <id-or-dir> [--status <STATUS>] [execution facts]
                             [intent and attribute options of `run create`]
memon run launch             <id-or-dir> [--detach] [--restart] [--stage-target <steps>]
memon run resume             <id-or-dir> [--detach] [--allow-failed] [--stage-target <steps>]
memon run stop               <id-or-dir> [--reason <stop-reason>] [--grace <seconds>]
memon run reconcile          <id-or-dir> [--assume-lost]
memon run progress           <id-or-dir>
memon run result             get|set|lint ...
memon run rename             <id-or-dir> <new-slug> [--project-root <p>]
memon run status set         <id> --to <STATUS> [--stop-reason <reason>] [--evidence <text>]
                             [--expected-mtime <ms>]
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

`--preemptible` SHALL be rejected with `BAD_REQUEST` unless `--preemptible-reason` is also given, and `--resumable` SHALL be rejected with `BAD_REQUEST` unless `--checkpoint-dir` or `--progress-checkpoints` is also given.

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

#### Scenario: Launch commands are listed
- **WHEN** the user runs `memon run --help`
- **THEN** the list includes `create`, `launch`, `resume`, `stop`, `reconcile`, `progress` and `result`

#### Scenario: Preemptible without a reason
- **WHEN** the user runs `memon run create a --command x --preemptible`
- **THEN** the command exits 2 with `BAD_REQUEST` naming `--preemptible-reason` and creates nothing
