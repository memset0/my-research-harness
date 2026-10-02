## MODIFIED Requirements

### Requirement: Top AppBar with project view tabs

The dashboard SHALL render a sticky **AppBar** above the main content area containing:
- The memon brand on the left
- A `Tabs`-style switcher for `Experiments` / `Hypotheses` / `Journal` / `Reports` / `Code Review` / `Wiki`, scoped to the current project, in that left-to-right order, followed by `Scheduler` when the project has scheduler state (`.memon/sched/`)
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
- **AND** the `Wiki` tab sits immediately to the right of the `Code Review` tab, last in the switcher for projects without scheduler state

#### Scenario: Scheduler tab for owners
- **GIVEN** an owner viewing `project-a`, which has `.memon/sched/` state
- **WHEN** the AppBar renders
- **THEN** a `Scheduler` tab follows `Wiki` and navigates to `/p/project-a/scheduler`
- **AND** an exact-scope share viewer of the same project sees the same tab, while a project without scheduler state shows no `Scheduler` tab
