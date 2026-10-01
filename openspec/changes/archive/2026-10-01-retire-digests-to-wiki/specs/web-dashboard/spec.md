## MODIFIED Requirements

### Requirement: Project selector in top navigation

The dashboard SHALL display a project selector in the top navigation showing the projects from the active session's accessible set:

- For an **owner** session, the selector SHALL list all projects from the resolved `config.yml`.
- For a **viewer** session, the selector SHALL list ONLY projects in `useSession().scopeProjects`. If the scope contains exactly one project, the selector SHALL be replaced by a read-only `<span>` label naming the project. If the scope contains multiple projects, the selector renders a dropdown over those names.

Switching project (where applicable) SHALL update the experiment list, hypothesis view, journal view, reports inbox, and wiki to that project's data without full page reload, the same as today.

#### Scenario: Owner switching projects
- **WHEN** an owner clicks a different project in the selector
- **THEN** the URL updates with the project identifier and the views re-fetch data scoped to the new project

#### Scenario: Viewer with single-project scope
- **WHEN** a viewer with `scopeProjects = ["project-a"]` opens the dashboard
- **THEN** the top-nav project label reads "project-a" as a plain `<span>` (no dropdown)
- **AND** there is no way to navigate to other projects from this surface

#### Scenario: Viewer with multi-project scope
- **WHEN** a viewer with `scopeProjects = ["project-a", "project-b"]` opens the dashboard
- **THEN** the selector dropdown lists the two scoped projects
- **AND** switching between them works as for owner

### Requirement: Sidebar narrows to scope-set projects in viewer mode

The application sidebar (`apps/web/components/app-sidebar.tsx`) SHALL render different content for owner vs. viewer sessions:

- **Owner**: full project list (unchanged from today).
- **Viewer**: ONLY the projects listed in `useSession().scopeProjects`. The project switcher dropdown SHALL be replaced by a read-only label when `scopeProjects.length === 1`. Sidebar nav-items that are inherently project-scoped (Experiments, Hypotheses, Journal, Reports, Wiki) SHALL link into the scope-set project; nav-items that aggregate across projects (e.g., a global "All anomalies" link) SHALL either be hidden OR filtered by scope.
- **Anon**: sidebar SHALL be hidden or replaced by the login-page chrome only.

#### Scenario: Viewer with single-project scope
- **WHEN** a viewer with `scopeProjects = ["project-a"]` opens the dashboard
- **THEN** the sidebar shows only "project-a" entries
- **AND** the project switcher is replaced by a `<span>project-a</span>` label

#### Scenario: Viewer with multi-project scope
- **WHEN** a viewer with `scopeProjects = ["project-a", "project-b"]` opens the dashboard
- **THEN** the sidebar shows project entries for both projects
- **AND** the project switcher dropdown is present, populated with the two

#### Scenario: Viewer aggregate links hidden
- **WHEN** a viewer is on any page
- **THEN** the sidebar does NOT show a "Manage tmux" link (the manage page is shell-classed)
- **AND** it does NOT show a "Settings" link (settings is owner-only mutating)
- **AND** it does NOT show the Slurm status widget (the `slurm-status` capability is owner-only; the widget is gated on `role !== 'viewer'` in the same conditional block that gates Manage tmux)

#### Scenario: Viewer project nav lists both Reports and Wiki
- **WHEN** a viewer with `scopeProjects = ["project-a"]` opens the dashboard
- **THEN** the project-scoped nav items include both `Reports` and `Wiki`, each linking into `project-a`
- **AND** the wiki entry is read-only: no review or edit action is offered

### Requirement: Code-review surface in project navigation

The per-project navigation SHALL include a "Code review" entry that links to
`/p/<project>/code-review`, shown alongside the existing experiments /
hypotheses / journal / reports / wiki surfaces and marked active when the
current path is under `/p/<project>/code-review`. The detail route
`/p/<project>/code-review/<...id>` SHALL be reachable both from that list and
from the experiment detail page's associated-reviews panel.

#### Scenario: Nav entry present and active
- **WHEN** the user is on `/p/<project>/code-review` or a detail route beneath it
- **THEN** the navigation shows a "Code review" entry in the active state

#### Scenario: Deep link resolves
- **WHEN** the user opens `/p/<project>/code-review/experiments/E0042-attn/code-review/2026-05-24-foo` directly
- **THEN** the detail page renders that doc (subject to auth)
