# Tasks — add-manage-drawer-toggle

## 1. Implementation

- [x] 1.1 Add `SidebarTrigger` to the imports in
  `apps/web/app/manage/layout.tsx`, sourced from
  `../../components/ui/sidebar` (alongside the existing
  `SidebarInset` import).
- [x] 1.2 Render a `<header>` strip inside `<SidebarInset>` as the
  first child, before the existing `<div className="flex min-h-0
  flex-1 flex-col overflow-hidden">{children}</div>`. The header
  SHALL use Tailwind classes
  `flex h-12 items-center gap-2 border-b border-border
  bg-background px-3` and contain a single `<SidebarTrigger />`.

## 2. Verification

- [x] 2.1 `pnpm --filter @memon/web typecheck` is clean.
- [x] 2.2 `pnpm --filter @memon/web test` is green.
- [x] 2.3 Restart the prod build per `CLAUDE.md`'s "Dev: prefer
  prod build" section (kill old PID first, then clear `.next` if
  needed, build, start).
- [x] 2.4 F1 protocol — fetch `/manage/tmux` with owner Basic
  credentials and confirm
  `data-slot="sidebar-trigger"` appears at least once in the
  rendered HTML.
- [x] 2.5 F4 protocol — the new strip uses `border-border` and
  `bg-background`; both are baseline shadcn tokens already defined
  in `apps/web/app/globals.css`, so no token verification is
  strictly required, but confirm with a grep just to be safe.
