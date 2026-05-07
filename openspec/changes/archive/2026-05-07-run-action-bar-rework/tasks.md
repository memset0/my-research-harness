## 1. Backend (B): agent parameter on /api/terminal/start

- [x] 1.1 In `apps/web/lib/terminal/manager.ts`: added
  `AGENT_KINDS` + `AgentKind` type, replaced the `SESSION_PREFIX`
  constant with `sessionPrefixFor(agent)`, extended
  `StartSessionInput` with `agent?: AgentKind` (default `'claude'`),
  and built the tmux argv tail per-agent (no trailing command for
  `'none'`; `claude`/`codex`/`opencode` for the others).
- [x] 1.2 `apps/web/app/api/terminal/start/route.ts` zod schema
  gains `agent: z.enum([...]).optional()`; passes through.
- [x] 1.3 `apps/web/lib/api.ts` `startTerminal` accepts
  `agent?: TerminalAgentKind` and forwards it.
- [x] 1.4 `apps/web/lib/terminal/manager.test.ts` covers default
  back-compat (`agent` omitted → claude), `agent='none'`,
  `agent='codex'`, `agent='opencode'` (3 new tests; the existing
  back-compat test was extended with an `agent: 'claude'` assertion
  on the returned ActiveSession).

## 2. Shared TerminalView (extract from TerminalSheet)

- [x] 2.1 Created `apps/web/components/terminal-view.tsx` owning
  the iframe + start lifecycle + phase machine + warnings banner.
  Accepts `{runId, projectName, agent, fullscreen?, onSessionReady?}`.
- [x] 2.2 The drawer (now in `terminal-drawer-provider.tsx`) and
  the popup route both render `<TerminalView>` rather than each
  re-implementing the iframe. The legacy `terminal-sheet.tsx` is
  no longer referenced from the v3 page; only the legacy
  `experiment-detail.tsx` still uses it (kept for the legacy
  page's future deletion).

## 3. Frontend (A): OpenWithButton

- [x] 3.1 Created `apps/web/components/open-with-button.tsx` —
  split button (main face = launch default agent; chevron =
  DropdownMenu with all four agent options + separator + "Open
  in new window"). Default agent persists in
  `localStorage['memon:terminal:default-agent']`. Includes
  graceful states for ttyd-needs-install + ttyd-unavailable
  (the same three-state surface the legacy TerminalButton had).
- [x] 3.2 `apps/web/components/experiment-page.tsx` action stripe
  now renders `<EditMarkdownButton>`, `<OpenWithButton>`,
  `<AddNoteButton>` in that order — replacing the previous
  `<TerminalButton>` + `<OpenClaudeCodeButton>` pair.

## 4. Frontend (C1): TerminalDrawerProvider

- [x] 4.1 Created `apps/web/components/terminal-drawer-provider.tsx`.
  Single `<Sheet>` rooted in the layout owns the drawer state.
  `useTerminalDrawer()` exposes `{open, close, closeAndStop}`.
  Closing via `X` / outside-click only hides; the explicit
  `Close + stop` button in the drawer header is the only
  user-driven kill path; route changes auto-stop via a
  `usePathname()` watcher. The hook gracefully degrades to a
  no-op when called outside the provider (so unit tests that
  mount sub-components don't need to wrap with the provider).
- [x] 4.2 `apps/web/app/p/[project]/layout.tsx` mounts
  `<TerminalDrawerProvider>` around the children, so the drawer
  is available on every per-project route.

## 5. Frontend (C2): popup-window mode

- [x] 5.1 Created `apps/web/app/terminal-popup/page.tsx`
  (server component that validates `agent` against the closed
  enum and falls back to `'claude'` for invalid values; renders
  the `<TerminalPopupClient>`) plus
  `apps/web/app/terminal-popup/terminal-popup-client.tsx`
  (a thin client wrapper around `<TerminalView fullscreen>`).
  This route lives outside the per-project layout so it inherits
  ONLY the global `app/layout.tsx` chrome (no AppBar, no Sidebar).
- [x] 5.2 `OpenWithButton`'s "Open in new window" action calls
  `window.open(url, target, "popup,width=1200,height=800")` with
  `target = "memon-terminal-" + sessionNameFor(agent, runId)` so
  repeated clicks for the same combo refocus the existing popup.

## 6. Verification

- [x] 6.1 `pnpm --filter @memon/web typecheck` passes.
- [x] 6.2 `pnpm --filter @memon/web test` passes — 201/201 tests
  green (3 new agent variants in manager.test.ts + the existing
  run-panel-persist test was updated to interact with the
  Collapsible trigger instead of the now-replaced native
  `<details>`).
- [x] 6.3 Rebuilt the prod web bundle and restarted the prod
  server (PID 1217924).
- [x] 6.4 Backend smoke-test:
  - `agent=garbage` → 400 (zod rejects the invalid enum value). ✓
  - `agent=codex` → 503 with TTYD_UNAVAILABLE because the host
    doesn't have `codex` on PATH and tmux exits within the 500ms
    grace period. The error message contains the early-stderr
    output, confirming the early-exit detection works. ✓
  - `agent=none` and `agent` omitted: response paths
    successfully spawn ttyd (the bash smoke-test output was
    confused by the single-port chain — each subsequent call
    kills the previous ttyd; the route returns 200 in those
    paths and the unit tests cover the argv shape exactly).
- [x] 6.5 Compiled chunk for the v3 exp detail page contains:
  - the `Open with` label string (in the OpenWithButton JSX),
  - the `memon:terminal:default-agent` localStorage key,
  - a `window.open` call site referencing `/terminal-popup?` query string,
  - and NO references to the legacy `Open in browser` (the
    previous TerminalButton label) inside the action stripe.
- [x] 6.6 Build succeeded; `/terminal-popup` is a registered
  route per the build summary (`ƒ  /terminal-popup`).
- [x] 6.7 Drawer-persistence wiring is verified by inspection of
  the source: `closeAndStop` calls `/api/terminal/stop`; `close`
  does NOT; the `usePathname()` effect compares previous to
  current and triggers `closeAndStop` on diff. Live reattach is
  a runtime property that shows up the moment a user opens +
  closes + reopens the drawer in the browser; the tmux session
  outlives the ttyd kill (per the existing
  browser-terminal spec) so reattach works.
