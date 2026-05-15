## ADDED Requirements

### Requirement: TerminalView broadcasts a terminal-attached event for cache holders

Every `<TerminalView>` instance SHALL post a message on a same-origin
`BroadcastChannel` named `memon:terminal-attached` once per mount,
fired exactly when the iframe enters the `ready` phase (i.e. after
the underlying `start` or `attach` POST resolves and the
`sessionName` is known). The message shape SHALL be:

```ts
type AttachedMessage = {
  sessionName: string  // resolved sessionName from the start/attach response
  source: 'manage' | 'drawer' | 'popup' | 'unknown'
  attachedAt: number  // Date.now() millis since epoch at broadcast time
}
```

The `sessionName` SHALL be the value returned by the `start` /
`attach` endpoint, NOT a synthesised guess from the input
`(project, scope, slug, agent)` quartet — the server's response is
the source of truth (e.g. when `agent` defaults to `'claude'` the
synthesis would still match, but using the server's value is the
robust path).

The `source` SHALL be derived from a new `source?: 'manage' |
'drawer' | 'popup' | 'unknown'` prop on `<TerminalView>`. Default
when absent: `'unknown'`. Known call sites SHALL pass the matching
value:
- `apps/web/components/terminal-drawer-provider.tsx` SHALL pass
  `source="drawer"` to its `<TerminalView>`.
- `apps/web/app/terminal-popup/terminal-popup-client.tsx` SHALL
  pass `source="popup"` to its `<TerminalView>` (both `mode='raw'`
  and `mode='standard'` branches).
- `apps/web/app/manage/tmux/tmux-page.client.tsx` SHALL pass
  `source="manage"` to every cached `<TerminalView>` it mounts in
  the right pane (per the `Right-pane TerminalView cache on
  /manage/tmux` requirement in the `tmux-session-management`
  capability).

The broadcast SHALL fire exactly ONCE per mount. Re-renders that do
NOT cross from `starting` / `error` to `ready` SHALL NOT fire it; a
mode change (raw ↔ standard) that re-runs the underlying `useEffect`
SHALL fire it again the next time `ready` is reached. The
`onSessionReady` callback (if provided) SHALL continue to fire
alongside the broadcast — the two are independent surfaces and SHALL
NOT be merged.

If `BroadcastChannel` is unavailable in the current browser
(`typeof BroadcastChannel === 'undefined'`), the broadcast SHALL be
silently skipped — no error, no warning. The `<TerminalView>` SHALL
otherwise render normally.

The channel instance MAY be created on demand inside the
`<TerminalView>` component (one channel per mount) or shared across
all `<TerminalView>` mounts in the same tab (one channel module-
local). Either is permitted; the wire format and semantics are
identical.

The channel SHALL be closed when the `<TerminalView>` instance
unmounts (`channel.close()` in the effect cleanup if a per-mount
channel) or kept open for the tab's lifetime if module-local. Per-
mount channels are simpler; module-local channels reduce
construction cost. The choice is implementation-internal.

#### Scenario: Standard-mode mount broadcasts on ready

- **GIVEN** a `<TerminalView mode="standard" project="project-a" scope="run" slug="foo-260507-103000" agent="claude" source="drawer" />` is freshly mounted
- **AND** the underlying `POST /api/terminal/start` resolves with `{ sessionName: "memon-claude-project-a--run--foo-260507-103000", url, port, ... }`
- **WHEN** the component transitions from `phase: 'starting'` to `phase: 'ready'`
- **THEN** a `BroadcastChannel('memon:terminal-attached')` SHALL post a message `{ sessionName: "memon-claude-project-a--run--foo-260507-103000", source: "drawer", attachedAt: <now-millis> }`
- **AND** any other tab subscribed to the same channel SHALL receive that message

#### Scenario: Raw-mode mount broadcasts on ready

- **GIVEN** a `<TerminalView mode="raw" sessionName="memon-manual-foo" source="popup" />` is freshly mounted
- **AND** `POST /api/terminal/attach` resolves with `{ sessionName: "memon-manual-foo", url, port, ... }`
- **WHEN** the component transitions to `phase: 'ready'`
- **THEN** the channel posts `{ sessionName: "memon-manual-foo", source: "popup", attachedAt: <now> }`

#### Scenario: source prop default is "unknown"

- **GIVEN** a `<TerminalView mode="standard" project="..." scope="run" slug="..." agent="claude" />` mount that does NOT pass a `source` prop
- **WHEN** it broadcasts on `ready`
- **THEN** the message's `source` field SHALL be `"unknown"`

#### Scenario: Broadcast fires once per mount, not on every re-render

- **GIVEN** a `<TerminalView>` is mounted and has reached `ready`
- **WHEN** the parent re-renders without changing the props that drive the mount effect (e.g. wrapping container layout shifts)
- **THEN** NO additional broadcast SHALL fire (the broadcast is gated on the `starting → ready` transition, which only happens once per mount/effect-run)

#### Scenario: Failed start does not broadcast

- **GIVEN** a `<TerminalView>` is mounted and `startTerminal` rejects (e.g. ttyd unavailable, network error)
- **WHEN** the component transitions from `phase: 'starting'` to `phase: 'error'`
- **THEN** NO `terminal-attached` broadcast SHALL fire

#### Scenario: BroadcastChannel unavailable does not throw

- **GIVEN** the browser does not support `BroadcastChannel` (`typeof BroadcastChannel === 'undefined'`)
- **WHEN** a `<TerminalView>` reaches `phase: 'ready'`
- **THEN** the broadcast step SHALL be skipped (no `new BroadcastChannel(...)` call)
- **AND** the iframe SHALL render normally
- **AND** no console error or warning is emitted by the broadcast code path

#### Scenario: Channel subscriber receives messages from same-origin popup window

- **GIVEN** tab `T1` (the manage page) subscribes to `BroadcastChannel('memon:terminal-attached')`
- **AND** tab `T1` opens a `window.open('/terminal-popup?...', target, features)` popup `T2`
- **WHEN** `T2`'s `<TerminalView>` reaches `ready` and broadcasts
- **THEN** `T1`'s subscriber SHALL receive the message
- **AND** the message's `source` field SHALL be `"popup"`

#### Scenario: onSessionReady callback continues to fire alongside the broadcast

- **GIVEN** a `<TerminalView ... onSessionReady={cb} />` mount where `cb` is provided
- **WHEN** the component reaches `phase: 'ready'`
- **THEN** `cb(sessionName)` SHALL be invoked exactly as today (the existing callback contract is unchanged)
- **AND** the broadcast SHALL ALSO fire — neither replaces the other
