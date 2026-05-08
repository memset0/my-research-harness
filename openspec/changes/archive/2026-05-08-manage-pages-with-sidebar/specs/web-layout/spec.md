## ADDED Requirements

### Requirement: AppSidebar visible on /manage/* pages

The dashboard SHALL render the `AppSidebar` (the same component that
appears under `/p/<project>/*` routes) on every page under the
`/manage/` prefix. This is achieved via a layout file at
`apps/web/app/manage/layout.tsx` that wraps `children` with
`<SidebarProvider>` + `<AppSidebar>` + `<SidebarInset>`.

The `/manage/*` layout SHALL NOT mount `<AppBar>` — AppBar is
project-scoped (its tabs target a single project) and does not apply
to cross-project pages.

The active-highlight on the sidebar's `Manage tmux` footer link
(already wired in `app-sidebar.tsx` as
`isActive={pathname === '/manage/tmux'}`) SHALL surface when the user
is on `/manage/tmux`, because the sidebar is now rendered there.

#### Scenario: Sidebar visible on /manage/tmux
- **WHEN** the user navigates to `/manage/tmux`
- **THEN** the left sidebar is visible (with the same project tree as
  on `/p/<project>/*` routes)
- **AND** the `Manage tmux` footer link in the sidebar has
  `data-active="true"` (the shadcn isActive style)

#### Scenario: AppBar absent on /manage/*
- **WHEN** the user is on `/manage/tmux`
- **THEN** no `<AppBar>` renders above the page content (no project
  tabs)

#### Scenario: Project list SSR-prefetched
- **WHEN** the `/manage/tmux` page server-renders
- **THEN** the response HTML contains the project names from
  `runtime.config.projects` inside the sidebar markup (no
  "No projects configured" flash on first paint)
