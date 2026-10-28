## ADDED Requirements

### Requirement: Sidebar is a reorderable project tree with section navigation

The sidebar SHALL list visible projects flat, each row showing the project name, a Host chip with the Host's availability, and the git status pill. Projects SHALL appear in the owner's saved order (user preference `memon:sidebar:project-order`, Host-qualified identities); projects missing from it SHALL follow in API order. Dragging a project row onto another SHALL move it there and save the order. An expanded project SHALL show Experiments, Journal, Reports, Code Review and Wiki, each linking to its list page with its count badge; Experiments, Reports and Wiki SHALL expand to list their items. The project, section and item of the current page SHALL be open, and the current item SHALL scroll into view. Expansion restored from browser storage SHALL NOT read project data; only the current project and projects opened in this session list their items.

#### Scenario: Opening a Report reveals it in the tree
- **WHEN** the user opens `/<host>/<project>/r/20`
- **THEN** that project and its Reports section are expanded, R0020 is marked current and scrolled into view

#### Scenario: Reordering projects
- **WHEN** the owner drags the second project row onto the first
- **THEN** the second project is listed first and the order persists across reloads and devices

### Requirement: AppBar shows the current location

The project AppBar SHALL show the sidebar trigger, a breadcrumb of Host, project and current section, and the Share control. It SHALL NOT render view tabs.

#### Scenario: Wiki page breadcrumb
- **WHEN** a Wiki page of `project-a` on Host `local` is open
- **THEN** the AppBar reads `local / project-a / Wiki`

## REMOVED Requirements

### Requirement: Central navigation hierarchy is Host then Project
**Reason**: Projects are listed flat in the owner's order; each project shows its Host as a chip.
**Migration**: None; Host availability stays visible on every project row.

### Requirement: Top AppBar with project view tabs
**Reason**: Section navigation moved into the sidebar tree.
**Migration**: Use the sidebar sections; the AppBar shows a breadcrumb.

### Requirement: AppBar tabs wrap on narrow viewports
**Reason**: The AppBar has no tabs.
**Migration**: None.

### Requirement: AppBar tabs and right controls share one responsive wrap flow
**Reason**: The AppBar has no tabs.
**Migration**: None.

### Requirement: Sidebar sections use a VSCode-Explorer-style banner header
**Reason**: Project rows are compact tree rows with a Host chip.
**Migration**: None.

### Requirement: Sidebar sections use a CSS Grid row-template for multi-expand height distribution
**Reason**: The sidebar scrolls as one tree so the current item can scroll into view.
**Migration**: None.

### Requirement: Section expand/collapse height animation
**Reason**: Replaced together with the grid row template.
**Migration**: None.
