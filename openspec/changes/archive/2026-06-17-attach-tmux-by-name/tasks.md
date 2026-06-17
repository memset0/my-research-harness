## 1. Backend: manager + attach endpoint

- [x] 1.1 In `apps/web/lib/terminal/manager.ts`, add `attachExistingSession({ sessionName, maxConcurrent, idleTtlMinutes })` that:
   - Validates `sessionName` matches `^memon-[A-Za-z0-9._-]+$` (throws `TerminalManagerError('BAD_REQUEST', ...)`).
   - Reuses the per-sessionName promise serializer (`state.startChains`).
   - Idempotent return: existing healthy entry → bump `lastActiveAtMs`, return `toPublic`.
   - LRU eviction at cap.
   - Allocates port via existing `allocatePort`.
   - Spawns ttyd with argv tail `tmux new-session -A -s <sessionName>` (no `-c`, no agent).
   - Builds the Entry via `parseSessionName(sessionName)` to fill `agent / project / scope / slug` (using `'none'` as the agent sentinel when parse returns null agent).
   - Returns `ActiveSession` (same shape as `startSession`).
- [x] 1.2 In `apps/web/lib/terminal/manager.ts`, factor the shared logic from `doStartSession` (probe ttyd, allocate port, spawn ttyd, register entry, exit handlers) into a small helper if it tightens the diff — otherwise just inline the necessary parts in `doAttachSession`. Keep both paths going through `state.startChains` per-sessionName.
- [x] 1.3 Create `apps/web/app/api/terminal/attach/route.ts`. POST handler with body `z.object({ sessionName: z.string().regex(/^memon-[A-Za-z0-9._-]+$/) })`. On valid body, fetch runtime, call `attachExistingSession({ sessionName, maxConcurrent, idleTtlMinutes })`. Return `{ sessionName, url: /api/terminal/proxy/<encoded>/, port, startedAt, warnings }`. Map `TerminalManagerError` to 400/503 same as `/start`.
- [x] 1.4 Tests for `attachExistingSession` in `apps/web/lib/terminal/manager.test.ts`:
   - Happy path: spawns `tmux new-session -A -s <name>` (no `-c`, no agent CLI tail).
   - Idempotent: second call returns same entry, no extra spawn.
   - Concurrent `start({ → 'X' })` and `attachExistingSession({ sessionName: 'X' })` produce one ttyd.
   - Invalid sessionName throws `BAD_REQUEST`.
- [x] 1.5 Tests for `/api/terminal/attach/route.ts` (new file `apps/web/app/api/terminal/attach/route.test.ts`):
   - 200 with valid sessionName.
   - 400 on missing/invalid `sessionName`.
   - 503 when manager throws `TTYD_UNAVAILABLE`.

## 2. Frontend: api.ts + drawer + view + popup

- [x] 2.1 In `apps/web/lib/api.ts`, add `attachTerminal(input: { sessionName: string }): Promise<TerminalStartResponse>` (POSTs to `/api/terminal/attach`, returns the same response type as `startTerminal`).
- [x] 2.2 In `apps/web/components/terminal-drawer-provider.tsx`:
   - Replace the existing `DrawerState` shape with a discriminated union:
     ```ts
     type DrawerState =
       | { kind: 'standard'; project; scope; slug; agent: TerminalAgentKind; sessionName: string | null }
       | { kind: 'raw'; sessionName: string }
     ```
   - Extend the context API with `openRaw({ sessionName }: { sessionName: string })`.
   - Update `handlePopOut` to branch on `kind`: standard → existing query-string shape; raw → `?sessionName=<encoded>`.
   - Drawer header: when `state.kind === 'raw'`, render the title as just the sessionName (no agent prefix, no description about scope).
   - Adjust the `<TerminalView>` rendering to pass either the standard props (when `kind === 'standard'`) or `mode='raw' sessionName={state.sessionName}` (when `kind === 'raw'`).
- [x] 2.3 In `apps/web/components/terminal-view.tsx`:
   - Change `TerminalViewProps` to a discriminated union: `{ mode: 'standard'; project; scope; slug; agent } | { mode: 'raw'; sessionName }` plus the shared `fullscreen?` and `onSessionReady?`.
   - In the effect, branch on `mode`: standard calls `startTerminal({ project, scope, slug, agent })`; raw calls `attachTerminal({ sessionName })`. The rest (phase / iframe / warnings) is shared.
   - Title fallback for the iframe — keep `${agent ?? 'terminal'} terminal` for standard; for raw use `${sessionName} terminal`.
- [x] 2.4 In `apps/web/app/terminal-popup/page.tsx`:
   - Extend `searchParams` parsing to accept an optional `sessionName`. When `sessionName` is present (and matches `^memon-[A-Za-z0-9._-]+$`), pass it through as raw mode. Otherwise fall back to the existing standard-mode parsing.
- [x] 2.5 In `apps/web/app/terminal-popup/terminal-popup-client.tsx`:
   - Accept either standard props or raw `{ sessionName }`. Render `<TerminalView>` with the appropriate `mode`.
- [x] 2.6 In `apps/web/app/manage/tmux/tmux-page.client.tsx`:
   - Update `SessionRow` so manual rows (`!row.matchable && !row.staleReason`) render `Drawer` + `Popup` + `Kill` (same buttons matchable rows have).
   - Manual-row Drawer button: calls `drawer.openRaw({ sessionName: row.sessionName })`.
   - Manual-row Popup button: opens `/terminal-popup?sessionName=<encoded>`.
   - Stale rows are unchanged (`Kill` only).

## 3. Verification

- [x] 3.1 `pnpm --filter @memon/web typecheck` passes.
- [x] 3.2 `pnpm --filter @memon/web test` passes.
- [x] 3.3 Rebuild prod via the CLAUDE.md restart sequence; wait until prod is up.
- [x] 3.4 Smoke-test `POST /api/terminal/attach`:
   - Create a manual session: `POST /api/tmux-sessions { name: "attach-test" }` → success.
   - `POST /api/terminal/attach { sessionName: "memon-manual-attach-test" }` → 200 with sessionName + url + port.
   - `POST` again → idempotent (same port, same startedAt).
   - `POST /api/terminal/attach { sessionName: "not-memon-prefix" }` → 400.
   - Anonymous → 401.
- [x] 3.5 Compiled-chunk verification on `/manage/tmux` chunk:
   - Contains `attachTerminal` (or its minified call site referencing `/api/terminal/attach`).
   - The manual-row branch renders Drawer + Popup buttons (literal `Drawer` and `Popup` strings present).
- [x] 3.6 Browser check (described, not run via curl):
   - Create a manual session; the row in /manage/tmux shows Drawer + Popup + Kill actions.
   - Click Drawer → drawer opens in raw mode (title = sessionName, no agent prefix); iframe loads.
   - Click Pop out from drawer → popup opens with `?sessionName=` URL; drawer closes; same ttyd shared.
   - Click Popup directly on a manual row → popup opens, ttyd attached.
   - Stale rows still show ONLY Kill (regression check).
   - Matchable rows still show Drawer + Popup + Kill via the standard path (regression check).
- [x] 3.7 Cleanup: kill the test session via the management page or `tmux kill-session -t memon-manual-attach-test`.
