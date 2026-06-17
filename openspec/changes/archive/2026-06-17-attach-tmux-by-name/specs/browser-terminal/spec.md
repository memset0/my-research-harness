## ADDED Requirements

### Requirement: POST /api/terminal/attach attaches ttyd to an existing tmux session by name

The web backend SHALL expose `POST /api/terminal/attach` accepting body `{ sessionName: string }` where `sessionName` matches `^memon-[A-Za-z0-9._-]+$`. The endpoint SHALL spawn ttyd with the tmux argv `tmux new-session -A -s <sessionName>` (no `-c`, no agent CLI tail) and register a manager entry the same way `POST /api/terminal/start` does, returning the same response shape:

```ts
{ sessionName: string; url: string; port: number; startedAt: string; warnings: string[] }
```

The `-A` flag means "attach if exists, else create". When the named tmux session is already running on the host, the spawned ttyd attaches to it and the user sees whatever process / shell / scrollback was already there. When the session does NOT exist, tmux creates it as a fresh bare-shell session at memon's `process.cwd()` (consistent with the `POST /api/tmux-sessions` create dialog's fallback behavior).

The endpoint SHALL be idempotent on the manager-side: a second `POST /api/terminal/attach` for a sessionName whose manager entry is already healthy returns the existing `{ sessionName, url, port, startedAt }` without spawning a new ttyd. This matches the `POST /api/terminal/start` dedup.

The endpoint SHALL be auth-gated (HTTP Basic) and classified as a `shell` route under `auth-system`.

The endpoint SHALL share the manager's per-sessionName promise serializer with `POST /api/terminal/start` so concurrent calls for the same sessionName from EITHER endpoint produce a single ttyd entry.

#### Scenario: Attach to an existing tmux session
- **GIVEN** a tmux session `memon-manual-foo` exists on the host (created via the New session dialog or externally)
- **WHEN** an authenticated client `POST`s `{ sessionName: "memon-manual-foo" }` to `/api/terminal/attach`
- **THEN** ttyd is spawned with `tmux new-session -A -s memon-manual-foo` (no `-c`, no agent)
- **AND** the response is 200 with `{ sessionName: "memon-manual-foo", url: "/api/terminal/proxy/memon-manual-foo/", port: <int>, startedAt: <iso>, warnings: [] }`

#### Scenario: Attach idempotently returns existing manager entry
- **GIVEN** the manager already holds a healthy entry for `memon-manual-foo` on port 7685
- **WHEN** the user `POST`s `{ sessionName: "memon-manual-foo" }` to `/api/terminal/attach`
- **THEN** the response carries `port: 7685, startedAt: <original>` (no new ttyd is spawned)

#### Scenario: Concurrent start + attach on the same name don't double-spawn
- **WHEN** `POST /api/terminal/start` (which would resolve to sessionName `memon-claude-project-a--run--foo`) and `POST /api/terminal/attach { sessionName: "memon-claude-project-a--run--foo" }` fire simultaneously
- **THEN** the per-sessionName serializer ensures exactly one ttyd is spawned and both responses return the same `(sessionName, url, port, startedAt)`

#### Scenario: Invalid sessionName rejected
- **WHEN** the body is `{ sessionName: "not-memon" }` (does not start with `memon-`)
- **THEN** the response is 400 with code `BAD_REQUEST`
- **AND** no ttyd is spawned

#### Scenario: Anonymous request rejected
- **WHEN** an anonymous client `POST`s to `/api/terminal/attach`
- **THEN** the response is 401 with `WWW-Authenticate: Basic realm="memon"`

## MODIFIED Requirements

### Requirement: Drawer state persists across panel close until route change

The browser-terminal drawer SHALL be opened and dismissed by a single `TerminalDrawerProvider` mounted in the ROOT layout (`apps/web/app/layout.tsx`), reachable from every page in the dashboard including `/manage/tmux`. The drawer state SHALL persist across pathname changes — navigation alone SHALL NOT close the drawer or kill the underlying ttyd / tmux.

The drawer state SHALL be a discriminated union with two modes:
- **Standard mode** (`kind: 'standard'`): carries `(project, scope, slug, agent)`. The drawer's `TerminalView` calls `POST /api/terminal/start` with these fields. This is the path used by the run/exp page action bar's `Open with` button.
- **Raw mode** (`kind: 'raw'`): carries just `sessionName`. The drawer's `TerminalView` calls `POST /api/terminal/attach { sessionName }` instead. This is the path used by `/manage/tmux` rows for **manual** sessions (legacy or arbitrary `memon-*` names) where no parsed target exists.

The provider SHALL expose two open methods on its context:
- `open(input: { project, scope, slug, agent })` — standard mode
- `openRaw(input: { sessionName })` — raw mode

The drawer header in raw mode SHALL show the sessionName as the title (no agent prefix, since "agent" doesn't apply to raw-attach).

Closing the drawer (the `X` button, escape key, or outside-click) SHALL hide the drawer WITHOUT calling `POST /api/terminal/stop`. The underlying ttyd + tmux session stays alive so the next open is an instant reattach.

The drawer SHALL NOT expose a `Close + stop session` button. The only path that kills tmux is the management page's `Kill` action (per the `tmux-session-management` capability). Killing ttyd (without killing tmux) is automatic via the LRU + Idle TTL machinery and does not need a per-drawer affordance.

The drawer's `<SheetContent>` SHALL size to `w-[min(80vw,1280px)] sm:max-w-[1280px]` — capped at 1280px on desktop and 80vw on small screens. Below the 1280px breakpoint the 80vw cap dominates so the underlying page always retains at least 20vw of visible width.

#### Scenario: Closing the drawer leaves ttyd and tmux alive
- **GIVEN** the user opened the terminal drawer for `(claude, project-a, run, foo-...)` and ttyd is running
- **WHEN** the user clicks the drawer's `X` close button
- **THEN** the drawer hides
- **AND** `POST /api/terminal/stop` is NOT called
- **AND** `GET /api/terminal/list` still returns the same session

#### Scenario: Reopening the drawer reattaches to the live ttyd
- **GIVEN** the drawer was closed (per scenario above) and the manager entry is still live
- **WHEN** the user clicks `Open with [claude code]` again from the same run panel
- **THEN** the drawer reopens with the same iframe URL — `startTerminal` returns the existing entry idempotently

#### Scenario: Route change keeps the session alive
- **GIVEN** the drawer is open with an active ttyd session for `(claude, project-a, run, foo-...)`
- **WHEN** the user navigates to a different route (e.g. clicks Hypotheses)
- **THEN** the drawer stays open showing the same iframe
- **AND** ttyd and tmux are unaffected
- **AND** the same drawer state survives navigation back to the original page

#### Scenario: Drawer is reachable from the management page
- **WHEN** the user is on `/manage/tmux` and clicks `Open in drawer` on a matchable row
- **THEN** the same `TerminalDrawerProvider` (mounted at root) opens the drawer on top of the management page
- **AND** the iframe loads the corresponding ttyd

#### Scenario: Manual row opens drawer in raw mode
- **GIVEN** the user is on `/manage/tmux` and clicks `Open in drawer` on a manual row (e.g. `memon-manual-foo`)
- **WHEN** the drawer opens
- **THEN** the provider's internal state is `{ kind: 'raw', sessionName: 'memon-manual-foo' }`
- **AND** the `TerminalView` calls `POST /api/terminal/attach { sessionName: 'memon-manual-foo' }` (NOT `/api/terminal/start`)
- **AND** the drawer header shows `memon-manual-foo` as the title (no agent prefix)

#### Scenario: Drawer width caps at 80vw on small screens
- **GIVEN** the viewport width is 1024px
- **WHEN** the drawer opens
- **THEN** the `<SheetContent>` is approximately 819px wide (80vw), NOT the 1280px desktop ceiling
- **AND** at least 205px (20vw) of the underlying page remains visible

#### Scenario: Drawer width caps at 1280px on wide screens
- **GIVEN** the viewport width is 1920px
- **WHEN** the drawer opens
- **THEN** the `<SheetContent>` is exactly 1280px wide (the absolute cap), NOT 1536px (80vw of 1920)

### Requirement: Popup-window mode opens the terminal in a separate browser window

The frontend SHALL provide TWO entry points to popup mode:

1. **Drawer header `Pop out` button**: opens the currently-shown drawer state in a popup window AND closes the drawer. Both views share the same ttyd via the manager's sessionName dedup. The button works for both standard and raw drawer modes.

2. **`/manage/tmux` row action `Open in popup`**: opens the row's session in a popup window. This action SHALL be hidden on viewports below the Tailwind `md` breakpoint (mobile browsers don't honor popup chrome).

The popup SHALL navigate to `/terminal-popup?...` opened via `window.open(url, target, features)` where:
- For **standard mode**: query is `project=<name>&scope=<exp|run>&slug=<slug>&agent=<kind>`.
- For **raw mode**: query is `sessionName=<full-tmux-session-name>`. When this query param is present, the popup route uses raw mode and ignores any standard-mode params.
- `target` SHALL be `memon-popup-<sessionName>` so repeated clicks for the same sessionName refocus the existing popup instead of duplicating.
- `features` SHALL be `popup,width=1200,height=800`.

The `/terminal-popup` route SHALL render a chrome-less page (no AppBar, no Sidebar) containing the same `TerminalView` body the drawer uses, sized to occupy the full popup viewport. The popup window inherits HTTP Basic auth from the same-origin browser auth cache.

#### Scenario: Pop out from drawer (standard mode)
- **GIVEN** the drawer is showing standard mode `(claude, project-a, run, foo-...)`
- **WHEN** the user clicks the `Pop out` button in the drawer header
- **THEN** `window.open('/terminal-popup?project=project-a&scope=run&slug=foo-...&agent=claude', 'memon-popup-memon-claude-project-a--run--foo-...', 'popup,width=1200,height=800')` is called
- **AND** the drawer closes immediately afterward
- **AND** when the popup mounts, its `startTerminal` call returns the same `(sessionName, url, port)` as the drawer was using

#### Scenario: Pop out from drawer (raw mode)
- **GIVEN** the drawer is showing raw mode `{ sessionName: 'memon-manual-foo' }`
- **WHEN** the user clicks `Pop out`
- **THEN** `window.open('/terminal-popup?sessionName=memon-manual-foo', 'memon-popup-memon-manual-foo', 'popup,width=1200,height=800')` is called
- **AND** the popup mounts in raw mode and calls `attachTerminal({ sessionName: 'memon-manual-foo' })`

#### Scenario: Open in popup from management page (matchable row)
- **WHEN** the user clicks `Open in popup` on a matchable row of `/manage/tmux`
- **THEN** the popup opens with the standard query shape derived from the row's parsed `(agent, project, scope, slug)`

#### Scenario: Open in popup from management page (manual row)
- **WHEN** the user clicks `Open in popup` on a manual row of `/manage/tmux`
- **THEN** the popup opens with `?sessionName=<row.sessionName>` (raw mode) and the popup mounts in raw mode

#### Scenario: Repeat-click refocuses the existing popup
- **GIVEN** a popup window is already open for `<sessionName-X>`
- **WHEN** the user clicks an action that pops out the same sessionName
- **THEN** `window.open` returns the existing window and that window is brought to focus, NOT a duplicate

#### Scenario: Mobile viewport hides the popup action on the management page
- **GIVEN** the viewport width is below the Tailwind `md` breakpoint
- **WHEN** the management page renders rows
- **THEN** every row's `Open in popup` button per row is `display: none` (Tailwind `hidden md:inline-flex`)
