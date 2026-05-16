# web-layout — Delta for add-manage-drawer-toggle

## ADDED Requirements

### Requirement: Manage pages render a visible SidebarTrigger for desktop drawer toggle

The `apps/web/app/manage/layout.tsx` layout SHALL render a visible
`<SidebarTrigger />` in the page chrome (above the manage page
body, inside the `<SidebarInset>`). Project pages already supply
this affordance via the `<AppBar>` they mount; manage pages —
which deliberately do NOT mount `<AppBar>` because that bar is
project-scoped — would otherwise leave desktop users without a
click affordance to collapse or expand the drawer. The trigger
SHALL behave identically to the one in `<AppBar>`: it toggles the
`sidebar_state` cookie, fires the same shadcn keyboard shortcut
(`Cmd/Ctrl+B`), and uses the same shadcn primitive
(`components/ui/sidebar` → `SidebarTrigger`).

#### Scenario: Trigger renders on /manage/tmux

- **GIVEN** an authenticated owner session
- **WHEN** the owner requests `GET /manage/tmux`
- **THEN** the response HTML contains at least one element with
  `data-slot="sidebar-trigger"`

#### Scenario: Click toggles the drawer

- **GIVEN** the owner is on `/manage/tmux` with the sidebar
  currently open (`sidebar_state=true`)
- **WHEN** the owner clicks the `<SidebarTrigger />` rendered in
  the manage layout chrome
- **THEN** the `sidebar_state` cookie value flips to `false`
- **AND** clicking it again flips the cookie back to `true`

#### Scenario: Visual placement

- **WHEN** the manage layout renders
- **THEN** the trigger sits in a dedicated strip above the manage
  page body — i.e. it is the first child of `<SidebarInset>` and
  it does NOT overlap or float on top of the `{children}` content
  region
