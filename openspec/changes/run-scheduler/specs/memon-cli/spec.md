## MODIFIED Requirements

### Requirement: Single binary `memon` with subcommands

The package SHALL expose a single CLI binary `memon` (registered via
`package.json` `bin`) with subcommands: `serve`, `list`, `show`,
`search`, `hypo`, `mock`, `experiment`, `run`, `update`, `share`,
`scan`, `journal`, `hypotheses`, `wiki`, `install-skills`, `fs-version`,
`index`, `project`, `components` and `sched`.
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
  including `experiment`, `run`, `wiki` and `sched`, exit code 0

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

### Requirement: Journal diagnostic query uses typed filters and stable paging

`memon journal read` SHALL provide explicit diagnostic history with AND-composed `--since`, `--until`, `--tag`, `--experiment-id`, `--run-id`, `--origin` (`cli`, `web`, `sched` or `legacy`), `--event` (a scheduling event type), `--node`, `--limit` and opaque `--cursor` filters. Default limit SHALL be 200 and maximum 1000. Timestamps SHALL compare as instants across timezone offsets. Output SHALL include events, nextCursor and origin/typed association information, not an active lastDigestAt. Experiment IDs and Run IDs SHALL be validated separately; a run-shaped experiment-id SHALL fail with an actionable run-id hint. Stable pagination SHALL not skip tied timestamps.

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

#### Scenario: Scheduler history by node
- **GIVEN** scheduling receipts on nodes `sim-a` and `sim-b`
- **WHEN** the user runs `memon journal read --origin sched --node sim-a`
- **THEN** only scheduling receipts whose node is `sim-a` are returned

## ADDED Requirements

### Requirement: `memon sched` runs and controls the project scheduler

The CLI SHALL expose `memon sched` with `run [--config <path>] [--once]`, `status`, `check-config [--config <path>]`, `submit <run> [--priority <n>] [--preemptible --preemptible-reason <text>] [--after <run>...] [--pool <name>] [--restart] [--allow-failed]`, `cancel <run>`, `pause <run>`, `resume <run>`, `priority <run> <n>`, `hold <node>`, `release <node>` and `drain <node>`, each taking `--project-root` and `--format json|human`, with the behavior of `run-scheduler`. Control subcommands SHALL only write one command file and, unless `--no-wait` is given, wait up to two scheduler ticks for its outcome; they SHALL exit 0 when the command was applied or is pending without a live scheduler (reporting `SCHEDULER_NOT_RUNNING`), 1 with the outcome code when the scheduler rejected it, and 2 for invalid arguments (`--preemptible` without `--preemptible-reason`, a non-integer priority). `run` SHALL exit 9 with `CONFLICT` when another scheduler holds the lease and 2 with `BACKEND_NOT_IMPLEMENTED` when a configured pool uses an unimplemented backend. `status` and `check-config` SHALL be read-only and not journaled; control subcommands SHALL record ordinary invocation receipts; scheduling events themselves are recorded by the scheduler.

#### Scenario: Submit and wait
- **GIVEN** a live scheduler with free capacity
- **WHEN** `memon sched submit logs/a-261002-090000 --priority 3` runs
- **THEN** it exits 0 after the scheduler applies the submission and prints the queue position

#### Scenario: Invalid priority
- **WHEN** `memon sched priority logs/a-261002-090000 high` runs
- **THEN** it exits 2 with `BAD_REQUEST` and writes no command file
