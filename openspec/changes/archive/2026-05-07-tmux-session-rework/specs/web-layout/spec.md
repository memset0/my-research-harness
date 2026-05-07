## ADDED Requirements

### Requirement: Sidebar footer with link to tmux management page

The `AppSidebar` component SHALL render a `<SidebarFooter>` containing a `<SidebarMenu>` with at least one item: a link to `/manage/tmux` (the new top-level cross-project tmux management page from the `tmux-session-management` capability).

The link SHALL use a `<SidebarMenuButton size="sm" asChild>` wrapping a Next.js `<Link href="/manage/tmux">` whose children are a lucide `Terminal` icon (`size-4`) and the text label `Manage tmux`.

The footer SHALL be visually distinct from the per-project Collapsible groups in `<SidebarContent>`, but follow shadcn's standard `SidebarFooter` styling (no custom backgrounds or borders). When the page route equals `/manage/tmux` the link SHALL render with `isActive` styling (per the existing active-highlight requirement).

The footer area SHALL be reserved for future `/manage/<other>` siblings; v1 only adds the tmux link.

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
