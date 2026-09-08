## MODIFIED Requirements

### Requirement: Top AppBar with view tab switcher

The dashboard SHALL render a sticky **AppBar** above the main content area containing:
- The memon brand on the left
- A `Tabs`-style switcher for `Experiments` / `Hypotheses` / `Journal` / `Reports` / `Digests` / `Code Review` / `Wiki`, scoped to the current project, in that left-to-right order
- A `+ New experiment` action on the right

#### Scenario: Tab navigation
- **WHEN** the user is on `/p/project-a/experiments/foo-260501-100000` and clicks the `Hypotheses` tab in the AppBar
- **THEN** the URL updates to `/p/project-a/hypotheses`; the AppBar's `Hypotheses` tab is now active

#### Scenario: New experiment from AppBar
- **WHEN** the user clicks `+ New experiment` while on any view of `project-a`
- **THEN** the existing new-experiment modal opens with `project-a` pre-selected

#### Scenario: Reports tab navigates to inbox
- **WHEN** the user clicks the `Reports` tab from any per-project view
- **THEN** the URL updates to `/p/<project>/reports`; the AppBar's `Reports` tab is active and the inbox shell renders

#### Scenario: Digests tab navigates to inbox
- **WHEN** the user clicks the `Digests` tab from any per-project view
- **THEN** the URL updates to `/p/<project>/digests`; the AppBar's `Digests` tab is active and the inbox shell renders

#### Scenario: Wiki tab navigates to the wiki surface
- **WHEN** the user clicks the `Wiki` tab from any per-project view
- **THEN** the URL updates to `/p/<project>/wiki`; the AppBar's `Wiki` tab is active and the wiki surface renders
- **AND** the `Wiki` tab sits immediately to the right of the `Code Review` tab, last in the switcher

### Requirement: Existing routes continue working unchanged

The pre-existing v2 URL routes SHALL be preserved or redirected. The URL
structure `/p/[project]`, `/p/[project]/hypotheses`,
`/p/[project]/journal`, `/p/[project]/reports[/<id>]`,
`/p/[project]/wiki[/<id>]`, and `/p/[project]/digests[/<id>]` SHALL be
preserved.

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

#### Scenario: Wiki detail URL is directly addressable
- **WHEN** the user types `/p/project-a/wiki/W0007` directly into the
  address bar
- **THEN** the wiki surface renders with `W0007` selected
- **AND** `/p/project-a/reports/R0007` continues to serve its Report

### Requirement: AppBar tab count badges reflect view-specific data

Tab badges SHALL count the identities of their own resource kind, not hydrated Run membership or another view's payload. They SHALL use the project-qualified inventory queries shared with navigation, show a loading placeholder rather than a false zero, and update through the resource heartbeat or mutation invalidation. Document/list SSE SHALL NOT be required.

#### Scenario: Experiment count is independent of Run bodies
- **WHEN** a project has twelve Experiment identities and unreadable Run documents
- **THEN** the Experiments badge can show twelve without reading those Run documents

#### Scenario: New Wiki identity
- **WHEN** a due inventory observation discovers another Wiki page
- **THEN** the next resource query updates the Wiki count without a full page reload

### Requirement: AppBar Experiments tab active-route coverage

The AppBar's `Experiments` tab SHALL render in its active visual
state on every URL where the user is semantically inside the
experiments view of the current project. The set of matching URLs
under `/p/<project>/` SHALL include:

- The bare project root (`/p/<project>` and trailing-slash variants).
- The v3 exp-doc detail route `/p/<project>/e/<exp-id>` (with or
  without the `?run=<run-dir>` query string).
- The legacy v2 detail route `/p/<project>/experiments/<run-id>`.
- The legacy run URL `/p/<project>/r/<run-id>` (which itself
  permanent-redirects to the v3 `/e/<exp-id>` URL — during the
  redirect the matcher SHALL still treat the URL as active so the
  highlight does not flicker off).

An `/p/<project>/e/<exp-id>` URL carrying side-workspace query
parameters (`?report=<R-id>`, `?reportSurface=…`, `?wiki=<W-id>`,
`?wikiSurface=…`) SHALL still match, because the left-side document
remains the Experiment.

The matcher SHALL NOT be naive prefix-matching that produces false
positives on sibling segments (e.g. it must distinguish
`/p/<project>/e/<id>` from a hypothetical `/p/<project>/eats`).

#### Scenario: Active on v3 exp-doc detail
- **WHEN** the user navigates to `/p/project-a/e/E0001-foo`
- **THEN** the AppBar's `Experiments` tab is rendered in the active
  state (using shadcn's `default` button variant), and `aria-selected`
  on the tab link is `true`

#### Scenario: Active on v3 exp-doc detail with auto-expanded run
- **WHEN** the user navigates to
  `/p/project-a/e/E0001-foo?run=foo-260501-100000`
- **THEN** the AppBar's `Experiments` tab is rendered in the active
  state

#### Scenario: Active on legacy v2 detail URL
- **WHEN** the user navigates to
  `/p/project-a/experiments/foo-260501-100000`
- **THEN** the AppBar's `Experiments` tab is rendered in the active
  state

#### Scenario: Active on bare project root
- **WHEN** the user navigates to `/p/project-a`
- **THEN** the AppBar's `Experiments` tab is rendered in the active
  state

#### Scenario: Not active on hypotheses route
- **WHEN** the user navigates to `/p/project-a/hypotheses`
- **THEN** the AppBar's `Experiments` tab is NOT in the active state;
  the `Hypotheses` tab is

#### Scenario: Not active on reports route
- **WHEN** the user navigates to `/p/project-a/reports`
- **THEN** the AppBar's `Experiments` tab is NOT in the active state;
  the `Reports` tab is

#### Scenario: Not active on wiki route
- **WHEN** the user navigates to `/p/project-a/wiki`
- **THEN** the AppBar's `Experiments` tab is NOT in the active state;
  the `Wiki` tab is

#### Scenario: Active with a side wiki page open
- **WHEN** the user navigates to
  `/p/project-a/e/E0001-foo?wiki=W0007&wikiSurface=split`
- **THEN** the AppBar's `Experiments` tab is rendered in the active
  state and the `Wiki` tab is not

### Requirement: Code Review tab label is title-cased

The AppBar's code-review view tab SHALL be labeled `Code Review` (both words
title-cased), consistent with the other title-cased tab labels
(`Experiments`, `Hypotheses`, `Journal`, `Reports`, `Wiki`, `Digests`).

#### Scenario: Tab renders title-cased label
- **WHEN** the AppBar renders the code-review tab
- **THEN** its visible label text is exactly `Code Review` (not `Code
  review`)

### Requirement: AppBar spans the paired-document workspace

On project routes, the AppBar SHALL be laid out above the complete content workspace rather than inside the left split region. Opening, closing, or resizing a right-side terminal, Report, or wiki page SHALL affect only the content region below the AppBar; it SHALL NOT divide, duplicate, horizontally compress, or obscure the AppBar. The project sidebar SHALL also remain outside the paired content split.

On manage routes, the manage header and SidebarTrigger SHALL follow the same rule when a terminal split is open.

#### Scenario: Project AppBar remains shared above Report split
- **GIVEN** a project page is open
- **WHEN** a Report opens in the right split
- **THEN** one AppBar spans above both the left document and the Report
- **AND** only the region below the AppBar is divided

#### Scenario: Project AppBar remains shared above terminal split
- **WHEN** a terminal opens in the right split on a project route
- **THEN** the AppBar retains the full project inset width above both content regions
- **AND** its tabs and controls are not constrained to the left region

#### Scenario: Manage header remains shared above terminal split
- **WHEN** a terminal opens in the right split on a manage route
- **THEN** the manage header remains above the divided content workspace
- **AND** its SidebarTrigger remains available

#### Scenario: Project AppBar remains shared above wiki split
- **GIVEN** a project page is open
- **WHEN** a wiki page opens in the right split
- **THEN** one AppBar spans above both the left document and the wiki pane
- **AND** only the region below the AppBar is divided
