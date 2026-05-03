## ADDED Requirements

### Requirement: shadcn Sidebar as primary project navigation

The dashboard SHALL use shadcn/ui's `Sidebar` family of components as its primary navigation container on desktop viewports, replacing the current top-bar project tabs. The Sidebar SHALL list every project from the resolved config.

#### Scenario: All projects visible
- **WHEN** the dashboard loads with N projects configured
- **THEN** the sidebar shows N collapsible groups, one per project, in config-declared order

#### Scenario: Sidebar collapses on narrow viewports
- **WHEN** the viewport width drops below the shadcn `Sidebar` mobile breakpoint (~768px)
- **THEN** the sidebar collapses behind a `<SidebarTrigger>` (hamburger) button placed in the AppBar; tapping the trigger slides the sidebar in as a drawer overlay

### Requirement: Per-project collapsed-by-default with on-demand run list

Each project group in the sidebar SHALL be **collapsed by default**. Clicking the project's header SHALL toggle expansion. When expanded, the group SHALL display the project's most recent **at most 5 experiments**, sorted by `createdAt` descending, each as a clickable row.

#### Scenario: Initial load
- **WHEN** the user opens the dashboard for the first time (no prior expanded state)
- **THEN** every project group is collapsed; no experiment rows are rendered in the sidebar

#### Scenario: Click to expand
- **WHEN** the user clicks a project header
- **THEN** the project expands and shows up to 5 experiment rows; the active project is also visually highlighted

#### Scenario: Fewer than 5 experiments
- **WHEN** an expanded project has only 3 experiments
- **THEN** all 3 are shown and no `View more` link appears

### Requirement: "View more" temporary expansion past 5 runs

When a project has more than 5 experiments and is expanded, the sidebar SHALL render a `View more` link below the 5 visible rows. Clicking the link SHALL temporarily reveal **all** the project's experiments inside the sidebar group; the expansion is **not** persisted across reloads.

#### Scenario: Show all rows
- **WHEN** a project with 12 experiments is expanded and the user clicks `View more`
- **THEN** the sidebar group renders all 12 experiment rows in place; the `View more` link is replaced by `Show fewer`

#### Scenario: Reset on reload
- **WHEN** the user reloads the page after clicking `View more`
- **THEN** the project group still expands to only 5 rows again (the temporary expansion is forgotten)

### Requirement: Sidebar expansion state persistence

The set of currently-expanded project groups SHALL persist across reloads via `localStorage` under key `memon:sidebar:expanded` (a JSON array of project names).

#### Scenario: Persistence across reload
- **WHEN** the user expands `project-a` and `project-c`, then reloads
- **THEN** `project-a` and `project-c` are still expanded after reload; `project-b` is still collapsed

#### Scenario: Stale entries
- **WHEN** the localStorage value contains a project name that is no longer in the config
- **THEN** the stale name is silently ignored (and pruned on next save)

### Requirement: Active highlight tracks URL

The sidebar SHALL visually highlight:
- The currently-active **project** (matching the URL's `[project]` segment), regardless of expansion state
- The currently-active **experiment** (matching the URL's `[id]` segment when on a detail page), only when its project is expanded

#### Scenario: On detail page
- **WHEN** the URL is `/p/project-a/experiments/foo-260501-100000`
- **THEN** the `project-a` group header has the "active project" treatment AND, if `project-a` is expanded, the `foo-260501-100000` row has the "active row" treatment

### Requirement: Top AppBar with view tab switcher

The dashboard SHALL render a sticky **AppBar** above the main content area containing:
- The memon brand on the left
- A `Tabs`-style switcher for `Experiments` / `Hypotheses` / `Journal`, scoped to the current project
- A `+ New experiment` action on the right

#### Scenario: Tab navigation
- **WHEN** the user is on `/p/project-a/experiments/foo-260501-100000` and clicks the `Hypotheses` tab in the AppBar
- **THEN** the URL updates to `/p/project-a/hypotheses`; the AppBar's `Hypotheses` tab is now active

#### Scenario: New experiment from AppBar
- **WHEN** the user clicks `+ New experiment` while on any view of `project-a`
- **THEN** the existing new-experiment modal opens with `project-a` pre-selected

### Requirement: Existing routes continue working unchanged

The URL structure `/p/[project]`, `/p/[project]/hypotheses`, `/p/[project]/journal`, and `/p/[project]/experiments/[id]` SHALL be preserved. The new layout only changes how navigation is presented, not how routes are addressed.

#### Scenario: Direct URL navigation
- **WHEN** the user types `/p/project-a/experiments/foo-260501-100000` directly into the address bar
- **THEN** the page loads with the sidebar showing `project-a` expanded and `foo-260501-100000` highlighted (as well as the AppBar `Experiments` tab active)

### Requirement: shadcn primitives replace hand-rolled UI components

The repo SHALL adopt shadcn/ui versions of `Button`, `Card`, `Badge`, `Dialog`, `Tabs`, `Tooltip`, `Collapsible`, `DropdownMenu`, `ScrollArea`, `Separator`, and `Sidebar`. The previous hand-rolled components in `components/ui.tsx` SHALL be replaced or re-exported from the new files so that import paths remain stable.

#### Scenario: No breaking import changes
- **WHEN** other components (e.g. `experiment-list.tsx`) `import { Button, Card, Badge, StatusPill } from './ui'`
- **THEN** those imports continue to resolve without code changes; the underlying implementation is now backed by shadcn

#### Scenario: Manual install (not interactive)
- **WHEN** adding shadcn components to the repo
- **THEN** component sources are committed directly under `apps/web/components/ui/*.tsx` (NOT installed via interactive `shadcn init` which has previously failed in this environment)
