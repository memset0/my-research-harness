## ADDED Requirements

### Requirement: Top AppBar with project view tabs

The dashboard SHALL render a sticky **AppBar** above the main content area containing:
- The memon brand on the left
- A `Tabs`-style switcher for `Experiments` / `Hypotheses` / `Journal` / `Reports` / `Code Review` / `Wiki`, scoped to the current project, in that left-to-right order
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

#### Scenario: Wiki tab navigates to the wiki surface
- **WHEN** the user clicks the `Wiki` tab from any per-project view
- **THEN** the URL updates to `/p/<project>/wiki`; the AppBar's `Wiki` tab is active and the wiki surface renders
- **AND** the `Wiki` tab sits immediately to the right of the `Code Review` tab, last in the switcher

### Requirement: Report inbox uses a reusable per-project shell

The dashboard SHALL provide a reusable inbox-shell component used by Reports and any future per-project page that browses a directory of markdown artifacts. The component SHALL accept the artifact `kind`, the project name, and a list of items as props, and SHALL render the desktop and mobile layouts described in the `inbox-viewer` capability. Per-kind copy (the empty-state message, the URL prefix used for navigation) SHALL come from props, not from internal switches.

#### Scenario: Reports route uses the shared shell
- **WHEN** `/p/<proj>/reports` renders on a disk-empty fixture
- **THEN** it uses the shared inbox shell, with the empty-state copy and URL prefix supplied as props rather than internal switches

## MODIFIED Requirements

### Requirement: Existing routes continue working unchanged

The pre-existing v2 URL routes SHALL be preserved or redirected. The URL
structure `/p/[project]`, `/p/[project]/hypotheses`,
`/p/[project]/journal`, `/p/[project]/reports[/<id>]`,
and `/p/[project]/wiki[/<id>]` SHALL be preserved. The standalone
`/p/[project]/digests[/<id>]` routes are retired and not served; migrated
digests are addressed by their Wiki routes.

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

### Requirement: Code Review tab label is title-cased

The AppBar's code-review view tab SHALL be labeled `Code Review` (both words
title-cased), consistent with the other title-cased tab labels
(`Experiments`, `Hypotheses`, `Journal`, `Reports`, `Wiki`).

#### Scenario: Tab renders title-cased label
- **WHEN** the AppBar renders the code-review tab
- **THEN** its visible label text is exactly `Code Review` (not `Code
  review`)

## REMOVED Requirements

### Requirement: Top AppBar with view tab switcher
**Reason**: Superseded by "Top AppBar with project view tabs", which drops the retired standalone Digest branch (a MODIFIED block cannot drop its Digest scenarios).
**Migration**: Behavior for Reports is unchanged under "Top AppBar with project view tabs". Migrated digests are ordinary Wiki pages of kind `digest`.

### Requirement: Inbox layout shell as a reusable per-project page shape
**Reason**: Superseded by "Report inbox uses a reusable per-project shell", which drops the retired standalone Digest branch (a MODIFIED block cannot drop its Digest scenarios).
**Migration**: Behavior for Reports is unchanged under "Report inbox uses a reusable per-project shell". Migrated digests are ordinary Wiki pages of kind `digest`.
