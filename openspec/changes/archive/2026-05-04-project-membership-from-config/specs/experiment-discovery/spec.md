## MODIFIED Requirements

### Requirement: In-memory index with front-matter projection

The system SHALL maintain an in-memory index of all discovered experiments. Each indexed entry SHALL carry a top-level `project` string field whose value is the `name` of the `config.yml` project whose `discoverExperiments` call surfaced the directory. The index entry SHALL also carry a projection of front-matter fields (`id`, `name`, `status`, `created_at`, `finished_at`, `hypotheses`, `tags`, `wandb`) and the front-matter `project:` value (now interpreted as an OPTIONAL sub-project label, NOT as the membership key), plus derived metadata (`mtime`, `path`, whether `README.md` exists). Membership filters (`memon list --project <name>`, `ExperimentIndex.list({ project })`, the web `/api/experiments?project=<name>` route) SHALL filter on the top-level `project` field, never on the front-matter projection.

#### Scenario: Top-level project equals config project name
- **WHEN** an experiment at `/mnt/p/logs/foo-260501-100000` is discovered via the project entry `{ name: "p", root: "/mnt/p" }` in `config.yml`
- **THEN** the indexed entry's top-level `project` field equals `"p"`, regardless of what (if anything) the README's front-matter `project:` says

#### Scenario: Membership filter ignores front-matter project
- **GIVEN** an experiment indexed under top-level `project: "sparse-fsdp"` whose README declares front-matter `project: predictive-skip-validation`
- **WHEN** the consumer calls `index.list({ project: "sparse-fsdp" })`
- **THEN** that experiment is in the result set
- **AND** when the consumer calls `index.list({ project: "predictive-skip-validation" })`, the experiment is NOT in the result set

#### Scenario: Index reflects parsed front matter
- **WHEN** an experiment's `README.md` declares `status: RUNNING` in its front matter
- **THEN** the index entry for that experiment exposes `status = "RUNNING"`

#### Scenario: Missing README still indexed
- **WHEN** a discovered experiment directory has no `README.md`
- **THEN** the index entry for that experiment has its top-level `project` set from config, `id` and `path` populated, `status` defaults to `UNKNOWN`, and a `hasReadme: false` flag is set

#### Scenario: Index update on poll change
- **WHEN** a poll cycle observes that a `README.md` `mtime` has advanced
- **THEN** the index entry for that experiment is re-parsed and updated within that poll cycle, before the cycle returns; the top-level `project` field is preserved (it is not derived from the front matter and so cannot drift on edit)

#### Scenario: Front-matter project preserved verbatim (no backfill)
- **GIVEN** an experiment indexed under top-level `project: "sparse-fsdp"` whose README front matter has no `project:` line at all
- **WHEN** the index entry is consumed
- **THEN** the top-level `project` field is `"sparse-fsdp"` AND the front-matter `project` field is empty/null (NOT silently filled in with `"sparse-fsdp"`)

## ADDED Requirements

### Requirement: Free-text search includes membership project and sub-project

The free-text search over experiments (used by CLI `memon search` and the web list-view's search box) SHALL match against BOTH the top-level `project` field AND the front-matter `project` (sub-project) field, in addition to the existing fields (id, name, command, tags, hypotheses, body when scope=all). Either match SHALL surface the experiment.

#### Scenario: Search by top-level project name
- **GIVEN** experiments indexed under top-level `project: "sparse-fsdp"` whose front-matter `project:` is `"predictive-skip-validation"`
- **WHEN** the user searches for `sparse-fsdp`
- **THEN** every such experiment is returned

#### Scenario: Search by sub-project name
- **GIVEN** the same experiments
- **WHEN** the user searches for `predictive-skip-validation`
- **THEN** the matching experiments are returned (membership unchanged; this is a search match, not a filter switch)
