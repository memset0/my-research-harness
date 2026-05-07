## 1. Config schema + types (foundation, no app-code dependency)

- [x] 1.1 `packages/core/src/schemas.ts`: tighten `ProjectConfigRawSchema.name` to `z.string().regex(/^[A-Za-z0-9-]+$/, "must match [A-Za-z0-9-]+")`.
- [x] 1.2 `packages/core/src/schemas.ts`: add `TerminalConfigRawSchema = z.object({ ttyd_max_concurrent: z.number().int().min(1).optional(), ttyd_idle_ttl_minutes: z.number().int().min(0).optional() }).optional()` and include it on `ConfigRawSchema`.
- [x] 1.3 `packages/core/src/types.ts`: add `TerminalConfig { ttydMaxConcurrent: number; ttydIdleTtlMinutes: number }`, `DEFAULT_TERMINAL = { ttydMaxConcurrent: 16, ttydIdleTtlMinutes: 30 }`. Add `terminal: TerminalConfig` to `Config`.
- [x] 1.4 `packages/core/src/config/load.ts`: read `cfg.terminal`, fill defaults, surface as `runtime.config.terminal`. Surface schema-validation errors with `projects[i].name`-keyed messages preserved.
- [x] 1.5 `packages/core/src/config/load.test.ts`: cover (a) default `terminal` block when absent, (b) partial config fills defaults, (c) negative `ttyd_max_concurrent` rejected, (d) project names with space / dot / slash rejected, (e) project name `project-a` accepted.

## 2. Terminal manager: multi-port + new naming + LRU + Idle TTL + resume

- [x] 2.1 `apps/web/lib/terminal/manager.ts`: replace single global slot with `Map<sessionName, Entry>` (pinned to `globalThis` to survive HMR). Define `Entry` per design.md D2.
- [x] 2.2 `apps/web/lib/terminal/manager.ts`: implement `allocatePort()` — scan from 7682 upward, listen-then-close probe via `node:net`, cap at 256 above start, throw `TTYD_UNAVAILABLE` on exhaustion. Return next free port.
- [x] 2.3 `apps/web/lib/terminal/manager.ts`: implement `buildSessionName({ agent, project, scope, slug })` returning `memon-<agent>-<project>--<scope>--<slug>`. Validate that `slug` doesn't contain `--`; throw on violation.
- [x] 2.4 `apps/web/lib/terminal/manager.ts`: implement `parseSessionName(name)` returning `{ agent, project, scope, slug, legacy }`. Detect legacy `memon-<agent>-<runId>` (no `--`) and classify as `legacy: true`.
- [x] 2.5 `apps/web/lib/terminal/manager.ts`: refactor `startSession` input to `{ project, scope, slug, agent? }`. Compute sessionName. Return existing entry if healthy + bump `lastActiveAt`. Else: enforce LRU eviction if at cap (step 2.8), allocate port (2.2), probe resume (2.6), build tmux argv (2.7), spawn ttyd, register entry.
- [x] 2.6 `apps/web/lib/terminal/manager.ts`: implement `probeResumeFlags({ agent, scope, project, slug, projectRootAbsPath, runDirAbsPath? })`. claude: detect `~/.claude/projects/<encoded-cwd>/` non-empty → `['--continue']` (need to confirm encoding rule from claude source/output during impl). codex: detect codex storage (path TBD; use `codex resume --last` form). opencode: TBD. Best-effort try/catch; on error/missing return `[]`.
- [x] 2.7 `apps/web/lib/terminal/manager.ts`: build tmux argv with `-c <cwd>` flag. cwd = run dir abspath (run scope) or project root abspath (exp scope). Append agent + resume flags.
- [x] 2.8 `apps/web/lib/terminal/manager.ts`: implement `evictLRU()` — find entry with smallest `lastActiveAt` and disconnected WS; kill ttyd; do NOT kill tmux; remove from map. If all entries are connected, evict the smallest-`lastActiveAt` regardless.
- [x] 2.9 `apps/web/lib/terminal/manager.ts`: implement Idle TTL polling — `setInterval(60_000)` walks map, kills entries whose `now - lastActiveAt > ttdIdleTtlMinutes*60_000` AND WS is disconnected. Skip the polling entirely when ttl is 0.
- [x] 2.10 `apps/web/lib/terminal/manager.ts`: replace single `SERIALIZER_KEY` with `Map<sessionName, Promise>` per-sessionName chain. Different sessionNames proceed concurrently.
- [x] 2.11 `apps/web/lib/terminal/manager.ts`: extend SIGINT/SIGTERM/beforeExit handlers to kill ALL entries (not just one). Idle TTL interval should also be cleared.
- [x] 2.12 `apps/web/lib/terminal/manager.ts`: export `bumpLastActiveAt(sessionName)` and `markDisconnected(sessionName)` so the proxy layer can update on WS open/close.
- [x] 2.13 `apps/web/lib/terminal/manager.ts`: extend `listSessions()` to return all entries.
- [x] 2.14 `apps/web/lib/terminal/manager.test.ts`: cover (a) sessionName builder + parser, (b) port allocator + exhaustion, (c) multi-entry coexistence, (d) LRU eviction triggered at cap, (e) Idle TTL = 0 disables, (f) Idle TTL = 30 evicts after 31 min (mock time), (g) idempotent reopen returns same entry, (h) slug `--` rejected with BAD_REQUEST, (i) resume probe returns `--continue` when claude store non-empty (mocked fs).

## 3. Server-core proxy: per-sessionName port lookup

- [x] 3.1 `apps/web/lib/server-core.ts`: replace static `proxyTarget = 'http://127.0.0.1:7682'` with per-request lookup. Extract `<sessionName>` from `req.url` (matching `^/api/terminal/proxy/([^/]+)/`), call `manager.lookupSession(name) → port`, build the proxy target string.
- [x] 3.2 `apps/web/lib/server-core.ts`: when sessionName not found in map, return 502 with `{ error: 'Bad Gateway: unknown session' }`.
- [x] 3.3 `apps/web/lib/server-core.ts`: on WebSocket upgrade success, extract sessionName, call `manager.bumpLastActiveAt(name)`. On upgrade `close` event, call `manager.markDisconnected(name)`. The bump is also the "WS connected" signal for LRU/TTL.
- [x] 3.4 `apps/web/lib/server-core.ts`: HTTP requests under proxy prefix should also bump `lastActiveAt` (not just WS), so polling clients keep entries alive.
- [x] 3.5 `apps/web/lib/server-core.test.ts`: cover (a) routing two concurrent sessions to two different ports, (b) unknown sessionName → 502, (c) unauthenticated upgrade → 401, (d) `lastActiveAt` bumped on successful WS upgrade.

## 4. /api/terminal/* route handlers

- [x] 4.1 `apps/web/app/api/terminal/start/route.ts`: replace `BodySchema` with `{ project, scope: z.enum(['exp','run']), slug, agent? }`. Drop `runId`. Forward to refactored `startSession`. Response shape unchanged.
- [x] 4.2 `apps/web/app/api/terminal/start/route.test.ts`: cover new body shape, slug-`--` rejection, project-regex rejection, idempotent re-call returns same entry, agent enum strictness, exp scope opens at project root cwd.
- [x] 4.3 `apps/web/app/api/terminal/list/route.ts`: enumerate full `manager.listSessions()`. Include `lastActiveAt` and parsed metadata in each row. Drop the v1-single-entry pretense.
- [x] 4.4 `apps/web/app/api/terminal/stop/route.ts`: keep — endpoint kills ttyd for a sessionName via `manager.stopSession(name)`. Verify the manager method updates the map.

## 5. tmux-discovery + /api/tmux-sessions endpoints

- [x] 5.1 `apps/web/lib/terminal/tmux-discover.ts` (NEW): export `listMemonTmuxSessions(rt: Runtime): Promise<TmuxSessionRow[]>` that runs `tmux ls -F "#{session_name}|#{session_created}|#{session_activity}"`, parses each line, filters to `memon-*`, classifies `(matchable, staleReason)` against `rt.config.projects` + run/exp indexes, joins with `manager.lookupSession(name)` to add `liveEntry`. Sort by `tmuxLastActivity` desc. Return `[]` gracefully if `tmux ls` exits non-zero.
- [x] 5.2 `apps/web/lib/terminal/tmux-discover.ts`: export `killTmuxSessionByName(name: string): Promise<void>` that runs `tmux kill-session -t <name>`. Validate `name` matches the new format OR legacy format before invoking — names not matching either are rejected (no exec).
- [x] 5.3 `apps/web/app/api/tmux-sessions/route.ts` (NEW): `GET` returns `{ sessions: TmuxSessionRow[] }` from `listMemonTmuxSessions`. Auth-gated. Classify the route as `read` under `auth-system`.
- [x] 5.4 `apps/web/app/api/tmux-sessions/[name]/route.ts` (NEW): `DELETE` invokes `killTmuxSessionByName` + `manager.stopSession(name)` to clear any cached entry. Auth-gated; classify as `shell` route. Return 404 when `tmux has-session` check fails.
- [x] 5.5 `apps/web/lib/terminal/tmux-discover.test.ts`: unit tests for parser + stale classification with mocked `tmux ls` output and mocked indexes (matchable, unknown-project, unknown-target, old-format, unparseable).
- [x] 5.6 `apps/web/app/api/tmux-sessions/route.test.ts` (NEW): cover empty list, mixed rows, anonymous rejected (401), DELETE happy path + 404 when missing.

## 6. Drawer lift to root + header changes

- [x] 6.1 `apps/web/app/layout.tsx`: wrap `children` with `<TerminalDrawerProvider>` (positioned inside `QueryClientProvider` and any auth-required providers).
- [x] 6.2 `apps/web/app/p/[project]/layout.tsx`: remove the `<TerminalDrawerProvider>` wrapper.
- [x] 6.3 `apps/web/components/terminal-drawer-provider.tsx`: drop the `usePathname()` route-change `closeAndStop` effect entirely. Drawer state SHALL persist across navigation.
- [x] 6.4 `apps/web/components/terminal-drawer-provider.tsx`: rename internal state shape to `{ project, scope, slug, agent, sessionName? }`. Drop `runId` / `projectName`.
- [x] 6.5 `apps/web/components/terminal-drawer-provider.tsx`: remove the `Close + stop session` button and `closeAndStop` API. The context now exposes only `{ open, close }`. Add a `Pop out` button (icon `ExternalLink`) that calls `window.open` with `target = memon-popup-<sessionName>` per the popup-window spec, then calls `close()`.
- [x] 6.6 `apps/web/components/terminal-drawer-provider.test.tsx`: update tests for the new shape; add a test that route change does NOT close the drawer; add a test for the Pop out button calling `window.open` + closing the drawer.

## 7. OpenWithButton + popup route + TerminalView signatures

- [x] 7.1 `apps/web/components/open-with-button.tsx`: change props to `{ project, scope, slug }`. Drawer open call passes `(project, scope, slug, agent)`. The "Open in new window" dropdown item builds the URL `/terminal-popup?project=...&scope=...&slug=...&agent=...`.
- [x] 7.2 `apps/web/components/experiment-page.tsx`: pass `(project, scope: 'run', slug)` to `<OpenWithButton>` for run panel rows. For the exp doc top stripe (if currently rendered there or to be added), render `<OpenWithButton scope="exp" slug={expDocId} project={...} />`.
- [x] 7.3 `apps/web/app/terminal-popup/page.tsx`: read `searchParams = { project, scope, slug, agent }`. Validate enums. Render `<TerminalPopupClient project={...} scope={...} slug={...} agent={...} />`.
- [x] 7.4 `apps/web/app/terminal-popup/terminal-popup-client.tsx`: pass through to `<TerminalView project scope slug agent fullscreen />`.
- [x] 7.5 `apps/web/components/terminal-view.tsx`: change props from `{runId, projectName, agent}` to `{project, scope, slug, agent}`. Forward to `startTerminal` with the new shape.
- [x] 7.6 `apps/web/lib/api.ts`: change `startTerminal({...})` body shape to `{ project, scope, slug, agent? }`. Drop `runId` field. Keep response shape the same.

## 8. Sidebar footer entry

- [x] 8.1 `apps/web/components/app-sidebar.tsx`: add `<SidebarFooter>` containing `<SidebarMenu>` with one `<SidebarMenuItem>` whose `<SidebarMenuButton size="sm" asChild>` wraps `<Link href="/manage/tmux">` with `<Terminal className="size-4" />` and "Manage tmux" label. Use `usePathname()` to set `isActive={pathname === '/manage/tmux'}`.
- [x] 8.2 `apps/web/components/app-sidebar.test.tsx`: cover footer link rendering + isActive state when current path is `/manage/tmux`.

## 9. /manage/tmux page

- [x] 9.1 `apps/web/lib/api.ts`: add `listTmuxSessions(): Promise<{ sessions: TmuxSessionRow[] }>` and `killTmuxSession(name: string): Promise<void>` clients.
- [x] 9.2 `apps/web/app/manage/layout.tsx` (NEW, optional): a thin layout that just inherits root and adds breadcrumb / page-title prefix. Skip if root is enough.
- [x] 9.3 `apps/web/app/manage/tmux/page.tsx` (NEW): server component, prefetches `['tmux-sessions']` via TanStack `getQueryClient`, dehydrates, renders the client component.
- [x] 9.4 `apps/web/app/manage/tmux/tmux-page.client.tsx` (NEW): client component. State: filter tab in `'all' | 'active' | 'stale'`. `useQuery` keyed `['tmux-sessions']` with `refetchInterval: 5000`. Manual Refresh button. Table:
   - Columns: Session, Agent, Scope, Project, Target, ttyd, Last activity, Actions.
   - Target column: clickable Link with `<ArrowUpRight>` icon when `matchable`; inline `<AlertTriangle> stale (<reason>)` text when not.
   - Actions: `Open in drawer` (calls `useTerminalDrawer().open(...)`), `Open in popup` (`hidden md:inline-flex` Tailwind classes; `window.open` per popup spec), `Kill` (confirm dialog → `killTmuxSession()` → invalidate query).
- [x] 9.5 `apps/web/app/manage/tmux/tmux-page.client.test.tsx`: cover filter tab toggling, action wiring (mock useTerminalDrawer + window.open + killTmuxSession), stale row Open in drawer still works.

## 10. Verification

- [x] 10.1 `pnpm --filter @memon/core typecheck` passes.
- [x] 10.2 `pnpm --filter @memon/web typecheck` passes.
- [x] 10.3 `pnpm --filter @memon/core test` passes (config + load).
- [x] 10.4 `pnpm --filter @memon/web test` passes (manager, tmux-discover, server-core, all routes, components).
- [x] 10.5 Rebuild prod via the CLAUDE.md restart sequence (kill old PID, then build, then start). Wait until prod is up.
- [x] 10.6 Read auth from `config.yml` (per CLAUDE.md). Smoke-test `POST /api/terminal/start`:
   - `{ project: "project-a", scope: "run", slug: "<existing-run-basename>", agent: "claude" }` → 200 with `sessionName = memon-claude-project-a--run--<slug>`.
   - `{ project: "project-a", scope: "exp", slug: "E0042-foo", agent: "codex" }` → 200 with the corresponding exp sessionName.
   - `{ project: "project-a", scope: "run", slug: "foo--bar" }` → 400 (slug double-hyphen).
   - `{ project: "bad name", scope: "run", slug: "..." }` → 400 (project regex).
- [x] 10.7 Smoke-test `GET /api/tmux-sessions`: lists the just-spawned sessions; create an external `tmux new-session -d -s memon-claude-fakeproj--run--x` and confirm it shows as `unknown-project` stale.
- [x] 10.8 Smoke-test `DELETE /api/tmux-sessions/<name>`: 200, then `tmux has-session -t <name>` exits non-zero.
- [x] 10.9 Page check: `curl -u <auth>` `/manage/tmux` returns 200 and the response HTML contains `Manage tmux` plus the table headers.
- [x] 10.10 Browser check: open `/manage/tmux`. Verify table renders with stale + active rows. Click `Open in drawer` on an active row → drawer opens, iframe shows tmux contents. Click `Pop out` in drawer header → popup opens; drawer closes. Click `Open in popup` on the management page (desktop viewport) → second popup opens. Click `Kill` on a row → confirm; row disappears + tmux session gone (verify via `tmux ls`).
- [x] 10.11 Browser check (LRU): set `terminal.ttyd_max_concurrent: 2` in `config.yml`, restart prod. Open three different sessions sequentially. Verify the oldest disconnected ttyd is evicted via `/api/terminal/list`. Reopen the evicted session — scrollback intact (confirms tmux preserved).
- [x] 10.12 Browser check (server-restart durability): with a tmux session running claude inside, kill memon serve and restart. Reopen the same `(agent, project, scope, slug)` — drawer reattaches via `tmux -A`, scrollback intact.
- [x] 10.13 Browser check (route persistence): open drawer for session A on a project page, navigate to `/manage/tmux` and back to the project. Drawer remains open showing session A.
- [x] 10.14 Browser check (mobile): emulate viewport < `md` breakpoint (e.g., 600px wide). The `Open in popup` button on `/manage/tmux` is hidden; `Open in drawer` and `Kill` are visible.
- [x] 10.15 Compiled-chunk verification on the `/manage/tmux` chunk: contains the literal string "Manage tmux", references to `/api/tmux-sessions`, and a `window.open` call for `/terminal-popup`.
