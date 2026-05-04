## ADDED Requirements

### Requirement: AppBar tabs for Reports and Digests

The per-project AppBar SHALL include two new tabs in addition to the existing Experiments / Hypotheses / Journal: `Reports` (active for paths under `/p/<proj>/reports/...`) and `Digests` (active for paths under `/p/<proj>/digests/...`). The tab order SHALL be Experiments / Hypotheses / Journal / Reports / Digests, left to right.

#### Scenario: Reports tab active on its routes
- **WHEN** the user is on `/p/sparse-fsdp/reports` or `/p/sparse-fsdp/reports/R0001`
- **THEN** the Reports tab in the AppBar is rendered active

#### Scenario: Switching tabs preserves project context
- **WHEN** the user clicks Digests while viewing a project
- **THEN** they navigate to `/p/<project>/digests` and the project context (sidebar selection, project layout's prefetched data) stays

### Requirement: Reports route serves the inbox shell

Routes `/p/[project]/reports` and `/p/[project]/reports/[id]` SHALL render the same shared inbox shell, parameterized with `kind="reports"`. The list-only URL SHALL show an empty right pane with the reports empty-state copy when no item is selected (or the directory is empty); the `[id]`-bearing URL SHALL highlight that item in the rail and render its content in the right pane.

#### Scenario: Direct deep link
- **WHEN** the user navigates to `/p/sparse-fsdp/reports/R0001`
- **THEN** the page renders the inbox shell with `R0001-predictive-skip-p3` highlighted in the rail and its content rendered

#### Scenario: List-only URL with no selection
- **WHEN** the user navigates to `/p/sparse-fsdp/reports`
- **THEN** the page renders the inbox shell with no item highlighted; the right pane shows the reports empty-state-when-none-selected copy

### Requirement: Digests route serves the inbox shell with `kind="digests"`

Routes `/p/[project]/digests` and `/p/[project]/digests/[id]` SHALL render the same shared inbox shell as Reports, parameterized with `kind="digests"`. The id pattern in the URL SHALL be the canonical 4-digit `D<NNNN>` form (the date suffix is part of the on-disk filename but not the URL).

#### Scenario: Digest URL contains canonical id only
- **GIVEN** a digest file `D0001-2026-05-04.md` on disk
- **WHEN** the rail renders its link
- **THEN** the link target is `/p/<proj>/digests/D0001` (NOT `/p/<proj>/digests/D0001-2026-05-04`)

## MODIFIED Requirements

### Requirement: Project selector in top navigation

The dashboard SHALL display a project selector in the top navigation showing all projects from the resolved `config.yml`. Switching project SHALL update the experiment list, hypothesis view, journal view, reports inbox, and digests inbox to that project's data without full page reload.

#### Scenario: Switching projects
- **WHEN** the user clicks a different project in the selector
- **THEN** the URL updates with the project identifier and the views re-fetch data scoped to the new project (including the now-existing Reports and Digests views)
