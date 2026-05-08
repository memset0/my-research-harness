## MODIFIED Requirements

### Requirement: Drawer state persists across panel close until route change

The browser-terminal drawer SHALL be opened and dismissed by a single `TerminalDrawerProvider` mounted in the ROOT layout (`apps/web/app/layout.tsx`), reachable from every page in the dashboard including `/manage/tmux`. The drawer state SHALL persist across pathname changes — navigation alone SHALL NOT close the drawer or kill the underlying ttyd / tmux.

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
- **WHEN** the user is on `/manage/tmux` and clicks `Open in drawer` on a row
- **THEN** the same `TerminalDrawerProvider` (mounted at root) opens the drawer on top of the management page
- **AND** the iframe loads the corresponding ttyd

#### Scenario: Drawer width caps at 80vw on small screens
- **GIVEN** the viewport width is 1024px
- **WHEN** the drawer opens
- **THEN** the `<SheetContent>` is approximately 819px wide (80vw), NOT the 1280px desktop ceiling
- **AND** at least 205px (20vw) of the underlying page remains visible

#### Scenario: Drawer width caps at 1280px on wide screens
- **GIVEN** the viewport width is 1920px
- **WHEN** the drawer opens
- **THEN** the `<SheetContent>` is exactly 1280px wide (the absolute cap), NOT 1536px (80vw of 1920)
