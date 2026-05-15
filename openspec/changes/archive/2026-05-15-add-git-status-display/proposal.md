## Why

memon dashboards are increasingly used while iterating on the underlying
code of the project being monitored — sweeping a run, then tweaking a
script and re-launching. Right now the dashboard gives no signal about
the working-tree state of each project. Users have to flip to a terminal
to answer "what branch am I on?", "did I forget to commit before that
last sweep?", "am I behind origin?". A zsh-git-plugin-style status
indicator surfaced directly in the dashboard closes that loop.

Two display destinations make sense:

- **Sidebar** — already lists every project; a compact branch + dirty
  indicator next to each name lets the user scan all projects at once.
- **Project-page footer** — a new VSCode-style fixed bottom bar on
  every `/p/<project>/**` page, surfacing the active project's git
  status while the user is reading runs / experiments / journal. This
  is also a foundation for future status widgets (build state,
  monitor state, etc.) that don't fit anywhere else on the page.

Commit history + diff viewing are out of scope for this change and will
be tackled in a follow-up.

## What Changes

- **NEW** `packages/core/src/git/status.ts` — read git status for a
  project root via `execFile('git', [...])`. Returns a discriminated
  union: `{ enabled: false, reason }` for non-repos / git missing /
  errors, vs `{ enabled: true, branch, detached, ahead, behind,
  staged, unstaged, untracked, dirty }` for live repos. Polled, no
  watchers.
- **NEW** `GET /api/projects/:name/git-status` — JSON endpoint that
  resolves the project name → `Config.projects[].root`, then calls
  the core reader. Owner sessions and viewer sessions in scope of the
  project both get read access; out-of-scope viewers get 403.
- **NEW** `apps/web/components/git-status-pill.tsx` — shared inline
  presentation (branch icon + name + colored dot for dirty + optional
  arrows for ahead/behind). Variants: `compact` (sidebar) and
  `footer`. Polls via TanStack `useQuery` with `refetchInterval`.
- **NEW** `git_status:` config block (`interval_ms`, integer ms,
  default 10000, minimum 1000). Single value drives BOTH the client's
  TanStack `refetchInterval` AND the server-side throttle window so
  the two cadences can't drift. Server reads it at startup; client
  receives it through a new SSR-injected `<script id="memon-runtime-
  config" type="application/json">` element in the root layout.
- **MODIFIED** `apps/web/components/app-sidebar.tsx` — each project
  row gains a compact git pill under (or beside) the project name.
  Non-git projects render nothing for the pill (no error, no warning).
- **NEW** `apps/web/components/project-footer.tsx` — fixed-bottom
  VSCode-style bar (~26px). Renders the footer variant of the git
  pill plus reserved space for future widgets. Pinned at the viewport
  bottom on all `/p/<project>/**` routes via the project-page layout.
- **MODIFIED** `apps/web/app/p/[project]/layout.tsx` — wraps children
  in a flex column so the footer sticks to the bottom while content
  scrolls; adds bottom padding so the last row isn't covered.

What's NOT changing:

- No new SSE topic. Git status is polling-only (5s `refetchInterval`),
  matching the cluster-safe "no watchers" rule from CLAUDE.md.
- No new `git` dependency in `package.json`. We shell out to the
  system `git` binary, mirroring how `slurm-status` shells out to
  `squeue`.

## Capabilities

### New Capabilities

- `git-status`: Git working-tree status surfaced per project in the
  dashboard. Covers the core reader, the `/api/projects/:name/
  git-status` endpoint, the polling cadence, the non-git fallback
  contract, the shared `git-status-pill` component, the sidebar
  placement, and the new project-page footer primitive.

### Modified Capabilities

(none — this change is additive)

## Impact

- **Code**:
  - new module `packages/core/src/git/` (status reader + types)
  - new route `apps/web/app/api/projects/[name]/git-status/route.ts`
  - new components `git-status-pill.tsx`, `project-footer.tsx`
  - touched components `app-sidebar.tsx`, `app/p/[project]/layout.tsx`
  - new API client function in `apps/web/lib/api.ts`
- **Tests**: unit tests for the parser (porcelain v2 output → struct),
  integration test for the API route, component-level snapshot for the
  pill + footer states.
- **Dependencies**: none added.
- **System**: assumes `git` binary in PATH on the host running the web
  server. Missing binary is treated as "git disabled" globally (the
  reader returns `{ enabled: false, reason: 'git-not-found' }`); no
  hard crash.
- **Performance**: one `git status --porcelain=v2 --branch` invocation
  per project per `git_status.interval_ms` (default 10s) while the
  dashboard is open. Cheap (≤ a few ms on typical research repos),
  bounded by an in-memory throttle in the API route using the same
  interval as the upper bound, so a busy multi-tab user still hits
  the underlying reader at most once per interval per project.
- **Security**: project name → root resolution goes through the
  existing `Config.projects` registry. No user-controlled paths reach
  `execFile`. Viewer scope is enforced at the route layer.
