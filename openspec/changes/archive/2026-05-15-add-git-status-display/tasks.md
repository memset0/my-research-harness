## 1. Core git status reader

- [x] 1.1 Create `packages/core/src/git/status.ts` exporting
      `readGitStatus(cwd, opts?)` and the `GitStatus` discriminated
      union type per spec D5.
- [x] 1.2 Implement the porcelain-v2 parser: extract `branch.head`,
      `branch.oid`, `branch.upstream`, `branch.ab`, and count file
      entries into staged / unstaged / untracked.
- [x] 1.3 Wire `execFile('git', ['status', '--porcelain=v2',
      '--branch', '--ignore-submodules=all'], { cwd, timeout: 3000 })`;
      classify ENOENT, "not a git repository" stderr, timeout, and
      generic non-zero exits per spec.
- [x] 1.4 Re-export `readGitStatus` and `GitStatus` from
      `packages/core/src/index.ts` so apps/web can import them.
- [x] 1.5 Unit tests in `packages/core/src/git/status.test.ts`
      covering: clean tracked branch, dirty branch with staged +
      unstaged + untracked, detached HEAD, no-upstream local branch,
      not-a-repo, ENOENT git-not-found (mock spawn), and timeout (use
      a hanging stub via `tmpdir` + a fake git on PATH or by
      shortening the timeout).
- [x] 1.6 `pnpm --filter @memon/core typecheck` clean.
- [x] 1.7 `pnpm --filter @memon/core test -- status.test.ts` green.

## 2. `/api/projects/:name/git-status` route

- [x] 2.1 Create `apps/web/app/api/projects/[project]/git-status/
      route.ts` with `export const dynamic = 'force-dynamic'` and a
      `GET` handler.
- [x] 2.2 Inside the handler: resolve project via
      `runtime.config.projects.find(p => p.name === params.project)`;
      return 404 on miss.
- [x] 2.3 Enforce viewer scope via `readIdentityFromRequest(req)`:
      viewer + project not in `scopeProjects` → 403.
- [x] 2.4 Implement the per-project throttle cache (`Map<string,
      { readAt: number; result: GitStatus }>`) with a 1000ms window;
      cached requests skip `readGitStatus`.
- [x] 2.5 Call `readGitStatus(project.root)` on cache miss; persist
      the result + `Date.now()` into the cache before returning.
- [x] 2.6 Integration test
      `apps/web/app/api/projects/[project]/git-status/route.test.ts`
      covering: registered owner GET returns 200, unknown name
      returns 404, viewer-out-of-scope returns 403, two requests
      within 1s yield ONE call into the reader (assert via spy).
- [x] 2.7 Add `fetchGitStatus(name): Promise<GitStatus>` and the
      `GitStatus` type to `apps/web/lib/api.ts`, mirroring the shape
      of `fetchSlurmStatus`.

## 3. Shared `<GitStatusPill />` component

- [x] 3.1 Create `apps/web/components/git-status-pill.tsx`
      (client component) exposing
      `<GitStatusPill project; variant='compact'|'footer' />`.
- [x] 3.2 Use `useQuery({ queryKey: ['git-status', project], queryFn:
      () => fetchGitStatus(project), refetchInterval: 5_000,
      staleTime: 2_500 })`.
- [x] 3.3 Return `null` when query is pending on first mount, when
      `data.enabled === false`, or when fetch raises (caught by
      TanStack's `error` state).
- [x] 3.4 Implement the `compact` variant: `<GitBranch />` icon +
      truncated branch (or `(<short-sha>)` if detached) + colored dot
      when `dirty`. Wrap in shadcn `<Tooltip>` exposing ahead/behind
      and per-state counts.
- [x] 3.5 Implement the `footer` variant: monospace inline group,
      icon + branch + `↑a` `↓b` arrows (rendered only when nonzero)
      + `●s ○u ?n` count chips (only when nonzero). Tooltip surfaces
      the full upstream ref + all counts.
- [x] 3.6 Verify the semantic Tailwind tokens used
      (`text-muted-foreground`, `bg-card`, `border-border`,
      `text-primary`) actually have CSS variables defined in
      `apps/web/app/globals.css` per CLAUDE.md F4. If any are
      missing, surface that as a blocker — do NOT hand-write the
      tokens.
- [x] 3.7 Component test
      `apps/web/components/git-status-pill.test.tsx` (vitest + jsdom
      or `@testing-library/react`): mock the query, assert markup for
      the compact-dirty case, the footer-with-ahead-behind case, and
      the null case.

## 4. Sidebar integration

- [x] 4.1 Modify `apps/web/components/app-sidebar.tsx` to render
      `<GitStatusPill project={p.name} variant="compact" />` next to
      or under the project name in the project row.
- [x] 4.2 Tune the layout so the pill is visually secondary (smaller
      font / muted color) and does not push the project name out of
      the default sidebar width.
- [x] 4.3 Ensure non-git projects render exactly the prior layout
      (no spacing leak from the pill returning `null`).
- [x] 4.4 Update `apps/web/components/app-sidebar.test.tsx` (or add a
      new test) covering: pill mounts per project row.

## 5. `<ProjectFooter />` + project-page layout integration

- [x] 5.1 Create `apps/web/components/project-footer.tsx` exporting
      `<ProjectFooter project: string />` per spec.
- [x] 5.2 Style: `fixed bottom-0 left-0 right-0`, height 28px,
      `border-t`, `bg-card`, monospace, `text-xs`. z-index below
      sonner (which sits at 100) but above page content.
- [x] 5.3 Footer content: project name as a `Link` to
      `/p/<project>` on the left, `<GitStatusPill variant="footer"
      project={...} />` in the next slot, then a `flex-1` spacer
      reserved for future widgets.
- [x] 5.4 Modify `apps/web/app/p/[project]/layout.tsx` to:
      (a) resolve `params.project`, (b) wrap `{children}` in a
      container with `pb-8` to clear the footer, (c) mount
      `<ProjectFooter project={projectName} />` once below the
      children.
- [x] 5.5 Manual verification: on mobile and desktop, scroll the
      project root page to the bottom and confirm the last row is
      fully visible (not occluded).

## 6. End-to-end verification (CLAUDE.md UI protocol)

- [x] 6.1 `pnpm --filter @memon/web typecheck` clean.
- [x] 6.2 `pnpm --filter @memon/core test` and
      `pnpm --filter @memon/web test` green.
- [x] 6.3 Restart prod build per CLAUDE.md "Dev: prefer prod build"
      flow (kill old PID on :3737 → optional `rm -rf
      apps/web/.next` → `pnpm --filter @memon/core build` if core
      changed → `pnpm --filter @memon/web build` → `cd apps/web &&
      pnpm start`).
- [x] 6.4 Curl `/p/<a-git-project>` with owner Basic from `config.yml`
      and grep the served HTML for the project-footer markup
      (`project-footer` data slot or a unique class) and the
      git-status pill markup.
- [x] 6.5 Curl `/p/<a-git-project>/e/<some-exp-id>` and confirm the
      footer is also present on experiment sub-pages.
- [x] 6.6 Curl `/api/projects/<a-git-project>/git-status` and confirm
      `200` + a body with `enabled: true` and the expected fields.
- [x] 6.7 Curl `/api/projects/<a-non-git-project>/git-status` and
      confirm `200` + `{ enabled: false, reason: 'not-a-repo' }`.
- [x] 6.8 Curl the compiled CSS bundle and confirm every semantic
      token used by the footer + pill resolves to a real CSS variable
      in `:root` (CLAUDE.md F4 protection).
- [x] 6.9 `openspec validate add-git-status-display --type change`
      clean before handing the change back to the user.

## 7. Configurable cadence (`git_status.interval_ms`)

- [x] 7.1 Add `GitStatusConfig` type + `DEFAULT_GIT_STATUS` to
      `packages/core/src/types.ts`; extend `Config` with
      `gitStatus: GitStatusConfig`. Default `intervalMs: 10000`.
- [x] 7.2 Add `GitStatusConfigRawSchema` to
      `packages/core/src/schemas.ts` and wire it into
      `ConfigRawSchema`.
- [x] 7.3 Read + validate `git_status.interval_ms` in
      `packages/core/src/config/load.ts` (default 10000, min 1000,
      throw `ConfigError` on violations). Also default `gitStatus`
      in `implicitCwdProject`.
- [x] 7.4 Unit tests in `packages/core/src/config/load.test.ts`:
      block absent → 10000; custom value flows through; below floor
      rejected; non-integer rejected.
- [x] 7.5 Rebuild `@memon/core` so the new type is visible to
      apps/web.
- [x] 7.6 Update
      `apps/web/app/api/projects/[project]/git-status/route.ts` to
      use `runtime.config.gitStatus.intervalMs` as the throttle
      window (replace the hard-coded `THROTTLE_MS = 1000` constant).
- [x] 7.7 Update the route test to provide
      `gitStatus.intervalMs` in the mocked runtime and exercise the
      "expires after intervalMs" scenario against the configurable
      value.
- [x] 7.8 Create `apps/web/components/runtime-config-bootstrap.tsx`
      mirroring `session-bootstrap.tsx`: server reads runtime, renders
      `<script id="memon-runtime-config" type="application/json">`
      with `{ gitStatus: { intervalMs } }`.
- [x] 7.9 Create `apps/web/lib/runtime-config.ts` exporting
      `readSerializedRuntimeConfig()` (server) and
      `useRuntimeConfig()` (client hook with the script-tag fallback
      to `intervalMs: 10000`).
- [x] 7.10 Mount `<RuntimeConfigBootstrap config={...} />` in
      `apps/web/app/layout.tsx` `<head>` alongside
      `<SessionBootstrap>`.
- [x] 7.11 Update `apps/web/components/git-status-pill.tsx` to read
      `intervalMs` via the new hook; set `refetchInterval =
      intervalMs` and `staleTime = intervalMs / 2`.
- [x] 7.12 Update `apps/web/components/git-status-pill.test.tsx` to
      cover the configurable interval (mock the runtime config hook).
- [x] 7.13 Add a commented-out `git_status:` block to
      `mock/config-template.yml` (or `config.yml.example`) showing
      the default and the floor.
- [x] 7.14 `pnpm --filter @memon/core typecheck`,
      `pnpm --filter @memon/web typecheck`, both core + web test
      suites green.
- [x] 7.15 Rebuild + restart prod; curl
      `/api/projects/project-a/git-status` twice within 1s, confirm
      ONE `readGitStatus` call (server cache hit; the prior test
      verified 1s but the new floor is 1s minimum, so behaviour is
      indistinguishable at high frequency — instead confirm the
      `<script id="memon-runtime-config">` payload contains
      `intervalMs: 10000` by default).
- [x] 7.16 `openspec validate add-git-status-display --type change`
      clean.
