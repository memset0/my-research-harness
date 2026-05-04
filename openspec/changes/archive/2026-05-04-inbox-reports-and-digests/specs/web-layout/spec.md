## ADDED Requirements

### Requirement: Inbox layout shell as a reusable per-project page shape

The dashboard SHALL provide a reusable inbox-shell component used by Reports, Digests, and any future per-project page that browses a directory of markdown artifacts. The component SHALL accept the artifact `kind`, the project name, and a list of items as props, and SHALL render the desktop and mobile layouts described in the `inbox-viewer` capability. Per-kind copy (the empty-state message, the URL prefix used for navigation) SHALL come from props, not from internal switches.

#### Scenario: Both Reports and Digests routes use the same shell
- **WHEN** comparing the rendered DOM of `/p/<proj>/reports` and `/p/<proj>/digests` on disk-empty fixtures
- **THEN** the layout structure is identical (same left rail width, same right pane area, same FAB position) and only the empty-state copy + URL prefix differ

## MODIFIED Requirements

### Requirement: Top AppBar with view tab switcher

The dashboard SHALL render a sticky **AppBar** above the main content area containing:
- The memon brand on the left
- A `Tabs`-style switcher for `Experiments` / `Hypotheses` / `Journal` / `Reports` / `Digests`, scoped to the current project, in that left-to-right order
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

### Requirement: Existing routes continue working unchanged

The URL structure `/p/[project]`, `/p/[project]/hypotheses`, `/p/[project]/journal`, and `/p/[project]/experiments/[id]` SHALL be preserved. The new routes `/p/[project]/reports[/<id>]` and `/p/[project]/digests[/<id>]` are additive. No existing route's shape or behavior changes.

#### Scenario: Direct URL navigation
- **WHEN** the user types `/p/project-a/experiments/foo-260501-100000` directly into the address bar
- **THEN** the experiment detail view renders at that URL exactly as before
