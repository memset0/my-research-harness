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
