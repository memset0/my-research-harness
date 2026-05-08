## 1. New layout file

- [x] 1.1 Create `apps/web/app/manage/layout.tsx`. Mirror the structure of `apps/web/app/p/[project]/layout.tsx` but: drop the `params` async + project lookup; drop `<AppBar>`; keep `<SidebarProvider>` + `<AppSidebar>` + `<SidebarInset>`. SSR-prefetch `['projects']` via `getProjectsData` and dehydrate into a `<HydrationBoundary>` so the sidebar renders projects in the initial HTML.
- [x] 1.2 Confirm `apps/web/app/manage/tmux/page.tsx` content padding still looks right after the layout's `<SidebarInset>` provides the outer flex shell. Adjust the `mx-auto max-w-[1400px] p-6` wrapper if it doubles up.

## 2. Verification

- [x] 2.1 `pnpm --filter @memon/web typecheck` passes.
- [x] 2.2 `pnpm --filter @memon/web test` passes.
- [x] 2.3 Rebuild prod via the CLAUDE.md restart sequence; wait until prod is up.
- [x] 2.4 `curl -u <auth>` `http://localhost:3737/manage/tmux` returns 200 AND the response HTML includes the sidebar markup (search for project names from `config.yml` and the `Manage tmux` footer link with `data-active="true"`).
- [x] 2.5 `curl -u <auth>` `http://localhost:3737/p/project-a` is unchanged (sidebar still renders identically; this is a regression check on the project layout).
- [x] 2.6 Browser check (described, not run via curl): `/manage/tmux` shows the sidebar; `Manage tmux` footer link is highlighted; clicking a project group from the sidebar still navigates correctly.
