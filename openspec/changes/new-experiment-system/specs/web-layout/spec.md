## MODIFIED Requirements

### Requirement: Per-project collapsed-by-default with on-demand experiment list

Each project group in the sidebar SHALL be collapsed by default. Clicking
the project's header SHALL toggle expansion. When expanded, the group
SHALL display the project's most recent **at most 5 experiments**, sorted
by `effective_updated_at` descending, each as a clickable row that
navigates to `/p/<project>/e/<exp-id>`.

The sidebar SHALL NOT show a separate "All Runs" entry — runs are
reachable only through their parent experiment page (or the orphan
cards on the project list page).

The per-project counter badge in the sidebar SHALL show the number of
**experiments** in that project (not the number of runs).

#### Scenario: Initial load
- **WHEN** the user opens the dashboard for the first time (no prior
  expanded state)
- **THEN** every project group is collapsed; no experiment rows are
  rendered in the sidebar

#### Scenario: Click to expand shows experiments not runs
- **WHEN** the user clicks a project header
- **THEN** the project expands and shows up to 5 experiment rows; each
  row's link target is `/p/<project>/e/<exp-id>` (NOT a run dir)

#### Scenario: Counter badge reflects experiment count
- **GIVEN** a project with 12 experiments containing 47 runs total
- **WHEN** the sidebar renders
- **THEN** the project's counter badge shows `12` (not `47`)

### Requirement: "View more" temporary expansion past 5 experiments

The sidebar SHALL provide a non-persistent "View more" affordance for
projects with more than 5 experiments. When a project has more than 5
experiments and is expanded, the sidebar SHALL render a `View more`
link below the 5 visible rows. Clicking the link SHALL temporarily
reveal all the project's experiments inside the sidebar group; the
expansion is NOT persisted across reloads.

#### Scenario: Show all rows
- **WHEN** a project with 12 experiments is expanded and the user
  clicks `View more`
- **THEN** the sidebar group renders all 12 experiment rows in place;
  the `View more` link is replaced by `Show fewer`

#### Scenario: Reset on reload
- **WHEN** the user reloads the page after clicking `View more`
- **THEN** the project group still expands to only 5 rows again

### Requirement: Active highlight tracks URL

The sidebar SHALL visually highlight:
- The currently-active **project** (matching the URL's `[project]`
  segment), regardless of expansion state
- The currently-active **experiment** (matching the URL's exp id when
  on `/p/<project>/e/<exp-id>` or `/p/<project>/e/<exp-id>?run=...`
  routes), only when its project is expanded

#### Scenario: On exp detail page
- **WHEN** the URL is `/p/project-a/e/E0001-foo` or
  `/p/project-a/e/E0001-foo?run=bar-260501-100000`
- **THEN** the `project-a` group header has the "active project"
  treatment AND, if `project-a` is expanded, the `E0001-foo` row has
  the "active row" treatment

### Requirement: Existing routes continue working unchanged or via redirect

The pre-existing v2 URL routes SHALL be preserved or redirected. The URL
structure `/p/[project]`, `/p/[project]/hypotheses`,
`/p/[project]/journal`, `/p/[project]/reports[/<id>]`, and
`/p/[project]/digests[/<id>]` SHALL be preserved.

The new route `/p/[project]/e/[exp-id]` is added for experiment detail.

The legacy route `/p/[project]/experiments/[run-dir]` SHALL respond
with a redirect to `/p/[project]/e/<E-id-of-parent>?run=<run-dir>` per
`web-dashboard`'s redirect requirement.

#### Scenario: Direct exp URL navigation
- **WHEN** the user types `/p/project-a/e/E0001-foo` directly into the
  address bar
- **THEN** the experiment detail view renders at that URL

#### Scenario: Legacy run URL redirects
- **WHEN** the user types `/p/project-a/experiments/bar-260501-100000`
- **THEN** the URL is rewritten to
  `/p/project-a/e/<exp-of-bar>?run=bar-260501-100000`

## REMOVED Requirements

### Requirement: Per-project collapsed-by-default with on-demand run list (v2)

**Reason**: V2's "run list" in the sidebar is replaced by an
"experiment list". Runs are no longer the primary navigation unit. The
v3 contract is the MODIFIED `### Requirement: Per-project collapsed-by-
default with on-demand experiment list` above.

**Migration**: Users will see experiment names in the sidebar instead
of run dir names. Drilling into an experiment shows its runs.

### Requirement: "View more" temporary expansion past 5 runs (v2)

**Reason**: V2 said "5 runs"; v3 says "5 experiments". Same mechanism,
different items. Replaced by the MODIFIED requirement above.

**Migration**: No user action.
