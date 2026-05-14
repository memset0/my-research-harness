## MODIFIED Requirements

### Requirement: Sidebar footer with link to tmux management page

The `AppSidebar` component SHALL render a `<SidebarFooter>` containing a `<SidebarMenu>` with at least one item: a link to `/manage/tmux` (the new top-level cross-project tmux management page from the `tmux-session-management` capability).

The link SHALL use a `<SidebarMenuButton size="sm" asChild>` wrapping a Next.js `<Link href="/manage/tmux">` whose children are a lucide `Terminal` icon (`size-4`) and the text label `Manage tmux`.

The footer SHALL be visually distinct from the per-project Collapsible groups in `<SidebarContent>`, but follow shadcn's standard `SidebarFooter` styling (no custom backgrounds or borders). When the page route equals `/manage/tmux` the link SHALL render with `isActive` styling (per the existing active-highlight requirement).

The footer area MAY contain additional siblings of the Manage tmux item that surface owner-only status / management affordances. v2 adds one such sibling: the **Slurm status widget** (capability `slurm-status`), mounted above the Manage tmux item, rendered only when `Config.slurm.totalNodes !== -1` AND `role !== 'viewer'`. When the Slurm feature is disabled by config (`total_nodes === -1`) the widget SHALL render nothing — the footer in that case is visually identical to v1.

The footer area SHALL remain reserved for future `/manage/<other>` siblings and other host-level status indicators.

#### Scenario: Sidebar shows the manage-tmux link in the footer
- **WHEN** the dashboard is rendered on a project page
- **THEN** the bottom of the sidebar shows a row with the `Terminal` icon and the label "Manage tmux"
- **AND** clicking the row navigates to `/manage/tmux`

#### Scenario: Active highlight on /manage/tmux
- **GIVEN** the current route is `/manage/tmux`
- **WHEN** the sidebar renders
- **THEN** the "Manage tmux" footer link has `data-active="true"` (the shadcn isActive style)

#### Scenario: Empty projects list still shows the footer
- **GIVEN** `runtime.config.projects` is empty (so `<SidebarContent>` shows "No projects configured")
- **THEN** the footer with the manage-tmux link is still visible

#### Scenario: Slurm widget mounts above Manage tmux when enabled
- **GIVEN** `Config.slurm.totalNodes === 8` and `role === 'owner'`
- **WHEN** the sidebar renders
- **THEN** the SidebarFooter contains two items: the Slurm status widget row (top), and the Manage tmux link (bottom)

#### Scenario: Slurm widget absent when disabled
- **GIVEN** `Config.slurm.totalNodes === -1`
- **WHEN** the sidebar renders
- **THEN** the SidebarFooter contains only the Manage tmux link; no Slurm row
