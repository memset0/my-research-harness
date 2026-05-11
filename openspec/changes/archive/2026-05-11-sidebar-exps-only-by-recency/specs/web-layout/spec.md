## MODIFIED Requirements

### Requirement: Per-project collapsed-by-default with on-demand run list

Each project group in the sidebar SHALL be collapsed by default.
Clicking the project's header SHALL toggle expansion. When expanded,
the group SHALL display the project's most recent **at most 5
experiments**, each as a clickable row that navigates to
`/p/<project>/e/<exp-id>`.

The expanded group SHALL render **exactly one** sub-section under the
project header — the experiments list. The sidebar SHALL NOT render a
separate `Runs` sub-section under any project group, and SHALL NOT
show a separate "All Runs" entry anywhere in the sidebar. Runs are
reachable only through their parent experiment page (or the orphan
cards on the project list page).

The experiment list SHALL be sorted by `effectiveUpdatedAt`
descending so the most recently active experiment appears at the top.
This matches the default order on the `Experiments` list page
(`experiment-card-grid.tsx`); the two surfaces SHALL stay in sync on
sort key and direction.

The expanded group MAY omit a sub-section heading label (e.g. an
uppercase "Experiments" caption above the list) since there is only
one sub-section per project group; the project group header itself
provides sufficient context.

The per-project counter badge in the sidebar SHALL show the number of
**experiments** in that project (not the number of runs).

Each rendered experiment row MAY display a small right-aligned badge
with the count of runs bound to that experiment (`runs.length`). The
badge is a passive number — it is not a separate clickable target.

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

#### Scenario: No Runs sub-section is rendered when expanded
- **WHEN** the user expands a project that has both v3 exp docs and
  legacy run dirs
- **THEN** the sidebar group renders the experiments list and nothing
  else under that project header — no `Runs` caption, no run rows, no
  link to a per-run URL

#### Scenario: Experiments rendered in `effectiveUpdatedAt`-descending order
- **GIVEN** a project with three exp docs A, B, C whose
  `effectiveUpdatedAt` are
  `2026-05-04T10:00:00+08:00` (A), `2026-05-06T08:00:00+08:00` (B),
  `2026-05-05T15:00:00+08:00` (C)
- **WHEN** the user expands the project's group
- **THEN** the rendered row order is B, C, A (top to bottom) — newest
  first, matching the default sort on the experiments list page

### Requirement: "View more" temporary expansion past 5 runs

The sidebar SHALL provide a non-persistent "View more" affordance for
projects with more than 5 experiments. When a project has more than 5
experiments and is expanded, the sidebar SHALL render a `View more`
link below the 5 visible rows. Clicking the link SHALL temporarily
reveal all the project's experiments inside the sidebar group; the
expansion is NOT persisted across reloads.

When the link is in its "all visible" state, its label SHALL change
to `Show fewer`; clicking it SHALL collapse back to the first 5 rows.

The 5-row cap and the "View more" affordance apply equally to
projects whose experiments exceed 5; pagination is independent of the
sort key (which is `effectiveUpdatedAt` descending per the previous
requirement).

#### Scenario: Show all rows
- **WHEN** a project with 12 experiments is expanded and the user
  clicks `View more`
- **THEN** the sidebar group renders all 12 experiment rows in place;
  the `View more` link is replaced by `Show fewer`

#### Scenario: Reset on reload
- **WHEN** the user reloads the page after clicking `View more`
- **THEN** the project group still expands to only 5 rows again

#### Scenario: View more preserves descending sort
- **GIVEN** a project with 12 experiments expanded; the user clicks
  `View more`
- **THEN** all 12 rows are rendered top-to-bottom in
  `effectiveUpdatedAt`-descending order — the newer 5 still appear
  above the older 7
