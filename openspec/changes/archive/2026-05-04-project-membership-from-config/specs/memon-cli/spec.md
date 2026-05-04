## MODIFIED Requirements

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
