## MODIFIED Requirements

### Requirement: Memon update pulls and installs latest CLI and skills
memon update SHALL fetch/pull the latest source from the configured trusted publication upstream with fast-forward-only semantics and install the CLI and bundled managed skills. It SHALL report selected revision and action results, preserve user-authored files, and refuse dirty/divergent source rather than reset or stash it. It SHALL avoid Web builds, Backend startup, remote test suites and central SHA equality. Installation failure SHALL retain a usable prior installation.

The installation SHALL build every workspace package output the CLI build needs, including the bundled skills package, from the CLI dependency closure alone; it SHALL NOT require output left by an earlier full workspace build, nor tools outside that closure. Rollback SHALL restore each of those package outputs as it was before the update.

When memon update is launched directly, the package-manager configuration the operator placed in the environment (`npm_config_*`, such as store, cache and state locations) SHALL apply to its dependency install and builds. Package-script lifecycle variables SHALL NOT reach those commands, and when memon update is itself launched from a package script, inherited package-manager configuration SHALL NOT redirect them either.

#### Scenario: Normal update
- **WHEN** a clean CLI installation invokes memon update with reachable upstream
- **THEN** latest source is pulled and CLI/managed skills are updated without remote unit tests

#### Scenario: Node without earlier skills build output
- **WHEN** a clean CLI installation that never built the bundled skills package invokes memon update
- **THEN** the skills package output is built before the CLI, the CLI build succeeds and the update completes

#### Scenario: Operator package-manager configuration in the environment
- **WHEN** the operator runs memon update directly with `npm_config_*` variables that relocate the package store, cache or state
- **THEN** the dependency install and builds use those locations instead of the package manager's defaults

#### Scenario: Launched from a package script
- **WHEN** memon update runs as a child of a package-manager script that exported lifecycle and `npm_config_*` variables
- **THEN** none of those inherited variables reach the nested install and builds

#### Scenario: Dirty checkout
- **WHEN** local source modifications or divergence prevent a safe update
- **THEN** the command reports the problem and preserves local work and the usable installation

#### Scenario: Install failure
- **WHEN** new CLI installation fails
- **THEN** the previous usable CLI and the previous outputs of every package it builds remain available and the command reports failure

#### Scenario: Custom skills
- **WHEN** a user has skills outside the managed bundle boundary
- **THEN** updating bundled skills does not overwrite those files
