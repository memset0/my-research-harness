## MODIFIED Requirements

### Requirement: Per-project collapsed-by-default with on-demand run list

Each project group in the sidebar SHALL be collapsed by default.
Clicking the project's header SHALL toggle expansion. When expanded,
the group SHALL display **all of the project's active (non-archived)
experiments**, each as a clickable row that navigates to
`/<host>/<project>/e/<n>` (`<n>` is the Experiment number without
leading zeros or slug). The list SHALL render inside an internally
scrollable container so long lists do not overflow the section
(the per-row scroll lives in the section's
`<div className="h-full overflow-y-auto">` inside
`<CollapsibleContent>`, fed by the outer grid-row sizing — see the
"CSS Grid row-template" requirement).

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

Each rendered experiment row SHALL render a leading circular
run-count badge as the row's first visual element — see the
"Experiment row leading run-count badge replaces the indent
gutter" requirement for full styling and accessibility. The badge
plays the role the previous transparent indent gutter played
(setting the row's leading column), while also exposing the
`runs.length` count.

#### Scenario: Initial load
- **WHEN** the user opens the dashboard for the first time (no prior
  expanded state)
- **THEN** every project group is collapsed; no experiment rows are
  rendered in the sidebar

#### Scenario: Click to expand shows experiments not runs
- **WHEN** the user clicks a project header
- **THEN** the project expands and shows experiment rows; each
  row's link target is `/<host>/<project>/e/<n>` (NOT a run dir)

#### Scenario: All active experiments are listed, not just the first 5
- **GIVEN** a project with 12 active (non-archived) experiments
- **WHEN** the user expands the project's group
- **THEN** all 12 experiment rows are rendered inside the section
  body
- **AND** the rendered list scrolls internally (`overflow-y-auto`)
  rather than expanding the sidebar to fit all 12 rows
- **AND** no "View more" or "Show fewer" affordance is rendered

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

#### Scenario: Leading visual is the run-count badge, not a transparent spacer
- **WHEN** a section is expanded
- **THEN** each experiment row's leading element is the circular
  run-count badge (per the "Experiment row leading run-count
  badge" requirement); there is NO transparent
  `<span aria-hidden className="w-6 shrink-0" />` spacer in front
  of the badge

### Requirement: Active highlight tracks URL

The sidebar SHALL visually highlight:
- The currently-active **project** (matching the URL's Host and
  Project segments), regardless of expansion state
- The currently-active **experiment** (matching the URL's Experiment
  number when on `/<host>/<project>/e/<n>` or
  `/<host>/<project>/e/<n>?run=...` routes), only when its project is
  expanded

#### Scenario: On exp detail page
- **WHEN** the URL is `/host-a/project-a/e/1` or
  `/host-a/project-a/e/1?run=bar-260501-100000`
- **THEN** the `project-a` group header under Host `host-a` has the "active project"
  treatment AND, if `project-a` is expanded, the `E0001-foo` row has
  the "active row" treatment

### Requirement: Active experiment row highlight covers its complete link

The sidebar SHALL highlight the row of the currently-open experiment (the row
whose Experiment number matches the `<n>` URL segment under
`/<host>/<project>/e/`) to
confirm navigation context. The highlight SHALL cover the complete native link,
including the leading run-count badge and experiment-id span.

The inner `<SidebarMenuButton>` SHALL remain the single source of the active
and hover background. There SHALL be no separate transparent indent gutter;
the leading run-count badge inside the link is the row's first visual element.

#### Scenario: Active row highlight covers badge and id
- **GIVEN** the user is viewing experiment `E0007-foo`
- **WHEN** the sidebar renders
- **THEN** one continuous active background covers the badge and experiment ID
- **AND** there is no detached trailing action outside that background

#### Scenario: Inactive row reverts to a hover-only tint
- **GIVEN** a project section is expanded with two experiments
  `E0001-alpha` and `E0002-beta`, and the user is viewing
  `E0001-alpha`
- **WHEN** the sidebar renders
- **THEN** only `E0001-alpha`'s row carries the
  `bg-sidebar-accent` wrapper background; `E0002-beta`'s row
  has no resting background and only paints
  `bg-sidebar-accent/40` on hover

#### Scenario: Inner SidebarMenuButton bg is suppressed
- **WHEN** any experiment row renders
- **THEN** the inner `<SidebarMenuButton>` element's class list
  includes `hover:bg-transparent` AND
  `data-[active=true]:bg-transparent` so the wrapper's background
  is the only one visible regardless of the button's own active
  / hover state

### Requirement: Central navigation hierarchy is Host then Project
Primary navigation SHALL expose configured Hosts and their live Projects with visible Host ownership and status. Project links SHALL use the canonical `/<host>/<project>` path. There SHALL be no standalone, project-only navigation: every Project the Web app serves belongs to a Host.

#### Scenario: Equal-name Projects are distinguishable in sidebar
- **WHEN** two Hosts expose `project-x`
- **THEN** the sidebar shows two entries under their respective Hosts with distinct links `/host-a/project-x` and `/host-b/project-x`

### Requirement: Top AppBar with project view tabs

The dashboard SHALL render a sticky **AppBar** above the main content area containing:
- The memon brand on the left
- A `Tabs`-style switcher for `Experiments` / `Journal` / `Reports` / `Code Review` / `Wiki`, scoped to the current Host-qualified project, in that left-to-right order, each tab linking to its canonical route under `/<host>/<project>`
- A `+ New experiment` action on the right

#### Scenario: Tab navigation
- **WHEN** the user is on `/host-a/project-a/e/1` and clicks the `Journal` tab in the AppBar
- **THEN** the URL updates to `/host-a/project-a/journal`; the AppBar's `Journal` tab is now active

#### Scenario: New experiment from AppBar
- **WHEN** the user clicks `+ New experiment` while on any view of `project-a`
- **THEN** the existing new-experiment modal opens with `project-a` pre-selected

#### Scenario: Reports tab navigates to inbox
- **WHEN** the user clicks the `Reports` tab from any per-project view
- **THEN** the URL updates to `/<host>/<project>/reports`; the AppBar's `Reports` tab is active and the inbox shell renders

#### Scenario: Wiki tab navigates to the wiki surface
- **WHEN** the user clicks the `Wiki` tab from any per-project view
- **THEN** the URL updates to `/<host>/<project>/wiki`; the AppBar's `Wiki` tab is active and the wiki surface renders
- **AND** the `Wiki` tab sits immediately to the right of the `Code Review` tab, last in the switcher

### Requirement: Report inbox uses a reusable per-project shell

The dashboard SHALL provide a reusable inbox-shell component used by Reports and any future per-project page that browses a directory of markdown artifacts. The component SHALL accept the artifact `kind`, the project name, and a list of items as props, and SHALL render the desktop and mobile layouts described in the `inbox-viewer` capability. Per-kind copy (the empty-state message, and the canonical item path used for navigation, such as `/<host>/<project>/r/<n>` for a Report) SHALL come from props, not from internal switches.

#### Scenario: Reports route uses the shared shell
- **WHEN** `/<host>/<proj>/reports` renders on a disk-empty fixture
- **THEN** it uses the shared inbox shell, with the empty-state copy and canonical item path supplied as props rather than internal switches

## REMOVED Requirements

### Requirement: Existing routes continue working unchanged
**Reason**: The hostless v2 routes it preserved (`/p/[project]`, `/p/[project]/journal`, `/p/[project]/reports[/<id>]`, `/p/[project]/wiki[/<id>]`, `/p/[project]/e/[exp-id]`) and the `/p/[project]/experiments/[run-dir]` redirect are retired and return 404; the hypotheses route was already retired. The page-routes capability now owns the route table.
**Migration**: Use the canonical Host-qualified routes from page-routes (`/<host>/<project>`, `/e/<n>`, `/journal`, `/reports`, `/r/<n>`, `/wiki`, `/w/<n>`); Host-qualified `/h/<host>/p/<project>/…` bookmarks 308-redirect to them.

### Requirement: AppBar Experiments tab active-route coverage
**Reason**: It matched hostless `/p/<project>/…` paths, the retired `/experiments/<run-id>` and `/r/<run-id>` Run URLs (`/r/<n>` is now a Report) and side-workspace query parameters that no longer exist.
**Migration**: Replaced by "AppBar tabs match canonical project routes", which defines the active state of every tab over the canonical routes.

## ADDED Requirements

### Requirement: AppBar tabs match canonical project routes
Each AppBar tab SHALL render in its active visual state (shadcn `default` button variant with `aria-selected="true"`) exactly on the canonical routes of its view under the current `/<host>/<project>`, with or without a trailing slash and with any query string:

- `Experiments`: `/<host>/<project>`, `/<host>/<project>/experiments`, and Experiment detail `/<host>/<project>/e/<n>` (including `?run=<run-dir>`), but not Experiment code reviews below it.
- `Journal`: `/<host>/<project>/journal`.
- `Reports`: `/<host>/<project>/reports` and `/<host>/<project>/r/<n>`.
- `Code Review`: `/<host>/<project>/code-review`, `/<host>/<project>/cr/<date>-<slug>` and `/<host>/<project>/e/<n>/cr/<date>-<slug>`.
- `Wiki`: `/<host>/<project>/wiki` and `/<host>/<project>/w/<n>`.

Matching SHALL compare whole path segments, so `/e/<n>` is not confused with a sibling segment such as `/eats` and `/r/<n>` is not confused with `/reports`. At most one tab SHALL be active.

#### Scenario: Active on Experiment detail
- **WHEN** the user navigates to `/host-a/project-a/e/1`
- **THEN** the AppBar's `Experiments` tab is rendered in the active state and `aria-selected` on the tab link is `true`

#### Scenario: Active on Experiment detail with auto-expanded run
- **WHEN** the user navigates to `/host-a/project-a/e/1?run=foo-260501-100000`
- **THEN** the AppBar's `Experiments` tab is rendered in the active state

#### Scenario: Active on both overview paths
- **WHEN** the user navigates to `/host-a/project-a` or `/host-a/project-a/experiments`
- **THEN** the AppBar's `Experiments` tab is rendered in the active state

#### Scenario: Report detail activates Reports
- **WHEN** the user navigates to `/host-a/project-a/r/7`
- **THEN** the AppBar's `Reports` tab is active and the `Experiments` tab is not

#### Scenario: Wiki page activates Wiki
- **WHEN** the user navigates to `/host-a/project-a/w/12`
- **THEN** the AppBar's `Wiki` tab is active and the `Experiments` tab is not

#### Scenario: Experiment review activates Code Review
- **WHEN** the user navigates to `/host-a/project-a/e/5/cr/2026-05-22-bf16-precision-guard`
- **THEN** the AppBar's `Code Review` tab is active and the `Experiments` tab is not
