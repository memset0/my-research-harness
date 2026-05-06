## ADDED Requirements

### Requirement: AppBar tab count badges reflect view-specific data

Each tab in the AppBar SHALL render a small count badge next to the
label whose value MUST match the data shown on that tab's view in the
current project. Specifically:

- The `Experiments` tab badge SHALL show the number of **experiment
  docs** in the project (the data behind `GET /api/experiments`,
  TanStack key `['experiments', project]`). It SHALL NOT show the
  number of runs.
- The `Hypotheses` tab badge SHALL show the number of hypothesis
  entries.
- The `Journal` tab badge SHALL show the project's total event count.
- The `Reports` tab badge SHALL show the number of reports.
- The `Digests` tab badge SHALL show the number of digests.

Each badge SHALL render a skeleton placeholder while its query is
still loading (to avoid the flash of `0`), and SHALL re-render with
the new value when its TanStack cache is invalidated by a relevant
SSE topic (`experiment-change` for the Experiments tab,
`run-change` for downstream effects on exp memberships, etc.).

#### Scenario: Experiments badge counts exp docs, not runs
- **GIVEN** a project with 12 exp docs and 47 runs
- **WHEN** the AppBar renders
- **THEN** the `Experiments` tab badge shows `12` (not `47`)

#### Scenario: Badge updates when an exp doc is created
- **GIVEN** the AppBar shows `Experiments 12`
- **WHEN** a new exp doc is created (via CLI, web POST, or an external
  edit) and the SSE `experiment-change` topic fires
- **THEN** the badge re-renders to `13` without a full page reload

#### Scenario: Loading state shows skeleton, not zero
- **WHEN** the AppBar mounts and the `['experiments', project]` query
  has not yet resolved
- **THEN** the badge renders a skeleton placeholder span (not the
  literal text `0`)

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
