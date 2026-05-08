## Why

`tmux-session-rework` shipped `/manage/tmux` as a top-level cross-project
route. The page is at `app/manage/tmux/page.tsx`, NOT under
`app/p/[project]/`, so it bypasses the project layout (`app/p/[project]/layout.tsx`)
that mounts `<SidebarProvider>` + `<AppSidebar>`. Result: the left
sidebar is invisible on `/manage/tmux`. The active-highlight on the
"Manage tmux" footer link is already wired (`isActive={pathname === '/manage/tmux'}`)
but never renders because the sidebar itself is missing on that route.

## What Changes

- Add `apps/web/app/manage/layout.tsx` that wraps `children` with
  `<SidebarProvider>` + `<AppSidebar>` + `<SidebarInset>`. SSR-prefetches
  `['projects']` so the sidebar renders projects in the initial HTML
  (no skeleton flash) — same pattern as the project layout.
- Do NOT include `<AppBar>`. AppBar takes a `project` prop and renders
  project-scoped tabs; `/manage/*` is cross-project so AppBar doesn't
  fit.
- Side effect: the active-highlight on the "Manage tmux" footer link
  now surfaces correctly when the user is on `/manage/tmux`, because
  the sidebar is now rendered there.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `web-layout`: SHALL render `<AppSidebar>` on `/manage/*` routes (in
  addition to the existing `/p/<project>/*` coverage).

## Impact

- `apps/web/app/manage/layout.tsx` (NEW) — adds the sidebar wrapper.
- `apps/web/app/manage/tmux/page.tsx` — unchanged at the markup level
  (the new layout wraps it). Inner padding may simplify since the
  layout's `<SidebarInset>` now provides the outer flex shell.
