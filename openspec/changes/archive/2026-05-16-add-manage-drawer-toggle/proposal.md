# Add visible SidebarTrigger on /manage/* pages

## Why

Project pages (`/p/<project>/**`) render `<AppBar>` which mounts a
`<SidebarTrigger />` — desktop users can click it to collapse/expand
the AppSidebar drawer. Manage pages (`/manage/tmux`, and any future
`/manage/*` route) deliberately do NOT mount `<AppBar>` because that
bar is project-scoped (project switcher, tab badges, share controls).
As a result the manage layout currently has no visible drawer-toggle
affordance: the keyboard shortcut `Cmd/Ctrl+B` still works, and the
mobile offcanvas swipe still works, but on desktop there is nothing
to click. The AppSidebar's resize handle only resizes; it does not
collapse.

## What Changes

- Render a minimal top strip inside `<SidebarInset>` in
  `apps/web/app/manage/layout.tsx`, containing only a
  `<SidebarTrigger />` from `components/ui/sidebar`.
- The strip uses `flex h-12 items-center gap-2 border-b
  border-border bg-background px-3` so its visual weight matches
  the project-page AppBar's header bar without pretending to be the
  AppBar (no tabs, no project switcher, no other controls).
- No new component file. The strip is a 5-line `<header>` inline in
  the layout — see `design.md` for the explicit decision against a
  new `ManageBar` component.
- Keyboard shortcut and mobile drawer behaviour are unchanged; this
  change only restores the click affordance on desktop.

## Capabilities

- `web-layout` (adds one requirement covering the manage-layout
  SidebarTrigger contract).

## Impact

- Affected code: `apps/web/app/manage/layout.tsx` (one edit).
- Affected specs: `web-layout` (one ADDED requirement).
- Risk: low. The change is additive — it does not touch AppBar,
  AppSidebar, or any project-page layout. Anything that currently
  works (keyboard shortcut, mobile offcanvas, resize handle) keeps
  working.
- Migrations / data: none.
- User-facing: desktop users on `/manage/tmux` can now click the
  hamburger icon at the top-left to collapse the drawer, matching
  the affordance present on project pages.
