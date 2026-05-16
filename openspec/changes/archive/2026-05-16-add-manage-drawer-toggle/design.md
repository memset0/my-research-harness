# Design — add-manage-drawer-toggle

## Decision: in-layout 5-line strip vs new `ManageBar` component

### Context

The manage layout (`apps/web/app/manage/layout.tsx`) mounts the
`AppSidebar` inside a `<SidebarInset>` but deliberately does not
mount `<AppBar>`. `<AppBar>` carries project-scoped UI — the project
switcher, tab badges, share dialog — which has no meaning on a
cross-project management page. Because `<AppBar>` is also the only
place that currently renders a visible `<SidebarTrigger />`, manage
pages end up without a click affordance for the drawer toggle.

Two ways to fix it:

1. **Inline strip.** Add a small `<header>` directly inside
   `<SidebarInset>` in `manage/layout.tsx`, containing just
   `<SidebarTrigger />`. About 5 lines of JSX.
2. **New `ManageBar` component.** Create
   `apps/web/components/manage-bar.tsx` as a sibling of
   `app-bar.tsx`, mount it from `manage/layout.tsx`, leave room
   for future manage-page-scoped controls (a global env switcher,
   a settings menu, etc.).

### Decision

Go with option (1): inline strip in `manage/layout.tsx`.

### Rationale

- **AppBar parity is explicitly not a goal.** The manage section
  is intentionally visually distinct from project pages — no tabs,
  no project switcher. Mimicking the AppBar's shape with a separate
  component would suggest the two are siblings, when the manage
  strip is in fact a strict subset (just the trigger).
- **YAGNI.** There are no other planned controls for the manage
  chrome today. The repo convention (`CLAUDE.md`) calls out the
  hazard of introducing component files speculatively. If/when the
  manage chrome grows a second control, that's the time to extract
  a component — the diff is then "extract" rather than "create
  speculative wrapper".
- **No fork hazard.** Option (1) consumes the shadcn
  `<SidebarTrigger />` primitive directly via the standard import
  path. No risk of F3 (forking shadcn primitives).
- **Minimal surface area.** The owner's explicit ask was a 5-line
  edit. A new component file would carry ~15-20 lines plus an
  import in the layout, and would create a second place future
  edits might need to land.

### Styling

The strip uses `flex h-12 items-center gap-2 border-b
border-border bg-background px-3` — copied from the AppBar's outer
header so the two surfaces line up at the same height and share
the same bottom-border treatment. `min-h-12` is not necessary
because the strip has fixed content (one icon button); the
AppBar uses `min-h-12 shrink-0` because its `<nav>` can wrap onto
a second row.

### Alternatives considered

- **Floating overlay button (e.g. a `fixed top-3 left-3
  <SidebarTrigger />`).** Rejected: the requirement is for the
  trigger to sit above the manage body, not overlap it. An overlay
  would visually float over the page body and require z-index
  bookkeeping.
- **Mount `<AppBar />` with a sentinel project value.** Rejected:
  AppBar has hard project-scoped logic (tab routes, share dialog);
  passing a sentinel would require either bypassing that logic or
  faking it. Either path is worse than a one-purpose strip.
- **Add the trigger inside the AppSidebar itself (e.g. as a
  collapsed-header button).** Rejected: the AppSidebar is shared
  by both project and manage layouts; adding the trigger there
  would duplicate the AppBar's trigger on project pages.
