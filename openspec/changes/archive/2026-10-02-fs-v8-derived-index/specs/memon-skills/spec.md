## ADDED Requirements

### Requirement: Skills treat the derived index as tool-maintained

Bundled skills SHALL NOT read, create, edit or delete files under `.memon/index/`, SHALL NOT commit them, and SHALL NOT add an index step to the FS preflight; the preflight remains `memon fs-version check` with its four branches, so a project at marker 7 is reported `behind` and the skill stops with the migrate-fs recommendation. Skills SHALL keep writing through memon commands, which maintain the index. Where a skill or the scripts it authors edit a Run README directly (for example a launcher rewriting `status`), the skill SHALL NOT require any index maintenance step; it MAY suggest `memon index status --verify` only when the user reports a list that disagrees with the files. Skills SHALL NOT create, edit, delete or commit `.memon/project.yml` themselves; when a user wants different Run locations, a skill SHALL recommend `memon project init` plus a manual edit and commit by the user, and MAY read the effective locations through `memon project lint`. Script-authoring skills SHALL place new Run directories at a location matched by the project's effective Run locations (the declared `run_dirs`, by default directly under `logs/`, `outputs/` or `experiments/`) and SHALL NOT create a Run directory inside another Run directory. `memon-migrate-fs` SHALL cover the v7-to-v8 step using its guide.

#### Scenario: Launcher edits status directly
- **WHEN** a skill-authored launcher rewrites a Run README from `RUNNING` to `FINISHED`
- **THEN** the skill instructions require no index command and the dashboard picks up the change through validation

#### Scenario: Skill on a v7 project
- **WHEN** a v8 skill runs its preflight on a project whose marker is 7
- **THEN** it stops, reports `behind` and recommends `memon-migrate-fs`, without touching `.memon/index/`

#### Scenario: Skill does not maintain the declaration
- **WHEN** a user asks a skill to keep Runs under `outputs/<group>/<run>`
- **THEN** the skill recommends `memon project init` and a manual edit of `run_dirs`, and does not write `.memon/project.yml` itself

#### Scenario: Generated Run location
- **WHEN** `memon-write-script` generates a launcher for a project without declared `run_dirs`
- **THEN** the launcher creates its Run directory as `logs/<slug>-<YYMMDD>-<HHMMSS>` (or another default location), never nested in a Run
