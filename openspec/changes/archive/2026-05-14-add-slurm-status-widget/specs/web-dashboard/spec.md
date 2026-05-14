## MODIFIED Requirements

### Requirement: Sidebar narrows to scope-set projects in viewer mode

The application sidebar (`apps/web/components/app-sidebar.tsx`) SHALL render different content for owner vs. viewer sessions:

- **Owner**: full project list (unchanged from today).
- **Viewer**: ONLY the projects listed in `useSession().scopeProjects`. The project switcher dropdown SHALL be replaced by a read-only label when `scopeProjects.length === 1`. Sidebar nav-items that are inherently project-scoped (Experiments, Hypotheses, Journal, Reports, Digests) SHALL link into the scope-set project; nav-items that aggregate across projects (e.g., a global "All anomalies" link) SHALL either be hidden OR filtered by scope.
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
