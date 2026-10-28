## ADDED Requirements

### Requirement: Sidebar is a reorderable project tree with section navigation

The sidebar SHALL list visible projects flat, each row showing the project name, a Host chip with the Host's availability, and the git status pill, without counts. Projects SHALL appear in the owner's saved order (user preference `memon:sidebar:project-order`, Host-qualified identities); projects missing from it SHALL follow in API order. Dragging a project row onto another SHALL move it there and save the order. An expanded project SHALL show Wiki, Experiments, Reports, Code Review and Journal, each linking to its list page; Wiki, Experiments and Reports SHALL expand into a flat list of their items ordered by update time, newest first (Experiments: ACTIVE ones only). Nothing SHALL be expanded by default except the current page's project and section; manual expansion lasts for the session. The current item SHALL be marked and scrolled into view. A project SHALL read its item lists only while expanded.

#### Scenario: Opening a Report reveals it in the tree
- **WHEN** the user opens `/<host>/<project>/r/20`
- **THEN** that project and its Reports section are expanded, R0020 is marked current and scrolled into view

#### Scenario: Reordering projects
- **WHEN** the owner drags the second project row onto the first
- **THEN** the second project is listed first and the order persists across reloads and devices

## REMOVED Requirements

### Requirement: Central navigation hierarchy is Host then Project
**Reason**: Projects are listed flat in the owner's order; each project shows its Host as a chip.
**Migration**: None; Host availability stays visible on every project row.

### Requirement: Sidebar sections use a VSCode-Explorer-style banner header
**Reason**: Project rows are compact tree rows with a Host chip.
**Migration**: None.

### Requirement: Sidebar sections use a CSS Grid row-template for multi-expand height distribution
**Reason**: The sidebar scrolls as one tree so the current item can scroll into view.
**Migration**: None.

### Requirement: Section expand/collapse height animation
**Reason**: Replaced together with the grid row template.
**Migration**: None.
