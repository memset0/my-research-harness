## ADDED Requirements

### Requirement: Sub-project tag in experiment list

The experiment list SHALL display a small sub-project badge/tag for each row whose front-matter `project:` value is non-empty AND differs from the enclosing memon project's name. Rows whose front-matter `project:` is empty OR equal to the enclosing project's name SHALL render no badge (avoids visual noise on the common case).

The badge content SHALL be the front-matter `project:` value verbatim. The badge SHALL be visually subordinate to the experiment id and status (smaller text, muted background) so it acts as a grouping hint, not a primary identifier.

#### Scenario: sparse-fsdp list shows recipe badges
- **GIVEN** memon project `sparse-fsdp` containing experiments with `frontMatter.project` values from the set `{predictive-skip-validation, justrl-with-verl, justrl-with-trl-fsdp2, slime-test}`
- **WHEN** the user opens `/p/sparse-fsdp`
- **THEN** each row shows a badge with its respective sub-project label, allowing visual grouping

#### Scenario: project-a list shows no sub-project badges
- **GIVEN** memon project `project-a` whose experiments all declare `frontMatter.project: project-a` (matching the enclosing project)
- **WHEN** the user opens `/p/project-a`
- **THEN** no rows render a sub-project badge (the values match, so the badge would be redundant)

#### Scenario: Mixed list — only divergent rows show badges
- **GIVEN** a memon project `mixed` with two experiments: one declares `frontMatter.project: mixed`, the other declares `frontMatter.project: foo`
- **WHEN** the user opens the list
- **THEN** only the second row renders the `foo` badge; the first renders no badge

## MODIFIED Requirements

### Requirement: Experiment detail page

Clicking an experiment in the list SHALL open a detail page showing:
- Front matter as a structured panel. The membership project (top-level `project`, set from `config.yml`) SHALL appear as a labeled row (e.g. "Project: sparse-fsdp"). When the front-matter `project:` is non-empty AND differs from the membership project, it SHALL appear as an additional row labeled "Sub-project: <value>"; when blank or equal, the sub-project row SHALL be omitted.
- Other front-matter rows: id, name, status, host, pid, gpus, created/finished, command, entry, wandb link.
- Body sections (Motivation/Setup/Method/Result/Conclusion/Caveats/Artifacts/(opt) New Hypotheses) as rendered markdown
- A "Hypotheses" panel listing related hypotheses with their current status emoji
- An "Artifacts" panel listing the parsed Artifacts section entries with clickable paths
- A "Resources" placeholder panel labeled "not yet available" (hook for future GPU/disk monitoring)

#### Scenario: Detail page shows sub-project when divergent
- **GIVEN** an experiment under memon project `sparse-fsdp` whose `frontMatter.project` is `predictive-skip-validation`
- **WHEN** the user opens its detail page
- **THEN** the front-matter panel shows both "Project: sparse-fsdp" and "Sub-project: predictive-skip-validation" as separate rows

#### Scenario: Detail page omits sub-project when equal
- **GIVEN** an experiment under memon project `project-a` whose `frontMatter.project` is `project-a`
- **WHEN** the user opens its detail page
- **THEN** the front-matter panel shows only "Project: project-a" (no separate sub-project row)

#### Scenario: Detail page labels project-only when sub-project absent
- **GIVEN** an experiment under memon project `project-a` whose `frontMatter.project` is empty/absent
- **WHEN** the user opens its detail page
- **THEN** the front-matter panel shows "Project: project-a" with no sub-project row
