## Context

`tmux-session-rework` introduced `/manage/` as the prefix for top-level
cross-project pages (currently just `/manage/tmux`). The route lives at
`app/manage/tmux/page.tsx` and inherits only `app/layout.tsx` (root —
just `Providers` + `Toaster`). The project layout
`app/p/[project]/layout.tsx` is the one that mounts `<SidebarProvider>`
+ `<AppSidebar>`, so anything outside `/p/[project]/*` has no sidebar.

Result: `/manage/tmux` looks bare, and the `Manage tmux` footer-link
active-highlight (already wired with `isActive={pathname === '/manage/tmux'}`)
never appears because the sidebar component itself isn't rendered.

## Goals / Non-Goals

**Goals:**
- The sidebar renders on `/manage/tmux` (and any future `/manage/<x>`
  routes) the same way it does on `/p/<project>/*` pages.
- The active-highlight on `Manage tmux` shows when the user is on the
  page — no extra plumbing needed; it falls out of the sidebar
  rendering.

**Non-Goals:**
- Render `<AppBar>` on `/manage/*`. AppBar is project-scoped (takes a
  `project` prop, renders project tabs); not applicable cross-project.
- Move the project layout's sidebar to root (`app/layout.tsx`). Doing
  that would also wrap `/terminal-popup` (intentionally chrome-less)
  and require an opt-out. A scoped `app/manage/layout.tsx` is simpler.

## Decisions

### D1. Add a scoped `app/manage/layout.tsx`

Mount `<SidebarProvider>` + `<AppSidebar>` + `<SidebarInset>` in a new
layout file that applies to every page under `app/manage/*`. The
existing project layout stays as-is; no refactoring to a shared layout.

Alternative considered: lift the sidebar to root (`app/layout.tsx`).
Rejected because `/terminal-popup` deliberately renders chrome-less
(no AppBar, no sidebar) and would inherit the sidebar from root,
requiring an opt-out — more total complexity than a per-section
layout.

### D2. Keep the layout async + SSR-prefetch projects

Match the project layout's pattern: `await getRuntime()` to read the
project list, prefetch `['projects']` into the QueryClient, dehydrate
into a `<HydrationBoundary>`. The sidebar renders projects in the
initial HTML — no "No projects configured" flash on first paint.

## Risks / Trade-offs

- [Risk] `/manage/tmux` page now has TWO outer flex shells —
  `<SidebarInset>` from the new layout AND the page's own
  `<div className="mx-auto max-w-[1400px] p-6">` wrapping. → Mitigation:
  trivial visual fix; `SidebarInset` provides the flex shell, the
  `mx-auto max-w-[1400px] p-6` stays inside it as the content
  container. Verified visually after the change lands.
- [Risk] Future `/manage/*` pages might want different chrome (e.g.,
  no sidebar). → Mitigation: not blocking; either the page can opt
  out at render time, or a future change introduces a route group.
