## ADDED Requirements

### Requirement: Right-pane TerminalView cache on /manage/tmux

The `/manage/tmux` right pane SHALL maintain an in-memory cache of up
to `MANAGE_TMUX_CACHE_CAP = 4` recently-selected `<TerminalView>`
instances so that switching back to a recently-visited row is a CSS
visibility flip rather than a full iframe re-mount. The cache SHALL be
local to the page component (`TmuxManagePageClient`) and SHALL be
discarded when the user navigates away from `/manage/tmux`.

The cache key SHALL be the row's `sessionName` (the same string used
as the `<TerminalView>` `key` prop). One cache entry holds one
`<TerminalView>` mount; sub-mounts (e.g. for raw-vs-standard mode) are
NOT separately cached — the mode is determined by the row's
classification at selection time and is fixed for the lifetime of the
cache entry.

The right pane SHALL render all cache entries simultaneously inside an
absolutely-positioned container. The currently-selected entry SHALL be
visible (no Tailwind `hidden` class); every non-selected cache entry
SHALL carry the Tailwind `hidden` class (which sets `display: none`)
so its iframe + WebSocket + xterm state remain mounted but the entry
contributes nothing to layout, paint, or pointer events. The cache
SHALL NOT use `<TerminalView>`'s `fullscreen` prop (the page-level
ResizablePanel sizes the container).

When the user selects a row whose sessionName is NOT in the cache:
1. If the cache is at cap, the entry with the oldest `lastSeenAt`
   (least-recently-selected) SHALL be removed from the cache. Its
   `<TerminalView>` SHALL unmount, closing its iframe and its
   WebSocket.
2. A fresh cache entry SHALL be created for the new sessionName, its
   `<TerminalView>` SHALL mount, and the entry's `lastSeenAt` SHALL
   be set to `Date.now()`.

When the user selects a row whose sessionName IS in the cache:
1. The cache entry's `lastSeenAt` SHALL be updated to `Date.now()`.
2. The previously-visible cache entry (if different) SHALL gain the
   `hidden` class; the newly-selected entry SHALL lose it.
3. NO `<TerminalView>` SHALL be unmounted; NO `start`/`attach` POST
   SHALL fire (the cached `<TerminalView>` instance was already past
   the `ready` phase).

Cache eviction SHALL also fire when:
- The row disappears from the `/api/tmux-sessions` refetch (e.g. the
  session was killed by the user via the page's Kill action, killed
  by `tmux kill-session` from a real terminal, or killed by a
  parallel manage-page tab). Cache cleanup follows the existing
  "selected session no longer present" cleanup path.
- The row is renamed via the page's Rename action. The old
  sessionName cache entry SHALL be dropped at the same time the URL
  is updated to the new sessionName. The new sessionName SHALL NOT
  be pre-allocated; it enters the cache via the normal "fresh
  selection" path.
- A `terminal-attached` `BroadcastChannel` message arrives for a
  sessionName that is in the cache AND is NOT the currently-selected
  entry — see the `Cross-page release of cached TerminalView via
  BroadcastChannel` requirement below.

The currently-selected cache entry SHALL never be evicted by LRU or
broadcast — only by row-disappearance or rename. If the user
explicitly selects a different row that is itself the LRU eviction
target (impossible because selecting bumps `lastSeenAt`) the rule is
moot.

The empty-state placeholder (the existing `RightPaneEmpty`) SHALL
render when `selectedName === null`. It is independent of the cache:
the cache may still hold up to `MANAGE_TMUX_CACHE_CAP` previously-
selected entries while the right pane displays the empty state. The
empty state SHALL be the only visible content in this case (every
cache entry carries the `hidden` class).

#### Scenario: Cache hit on switching back is a visibility flip with no fresh attach

- **GIVEN** the user has selected row `A` (`memon-claude-project-a--run--foo-260507-103000`), then row `B`, in that order — both rows are in the cache and `B` is currently visible
- **WHEN** the user clicks row `A`
- **THEN** no `POST /api/terminal/start` and no `POST /api/terminal/attach` SHALL fire for `A`'s sessionName
- **AND** `A`'s `<TerminalView>` SHALL remain the same React instance it was a moment ago (the iframe DOM node, the WebSocket, and the xterm state are preserved)
- **AND** `A`'s container SHALL lose the `hidden` class and `B`'s container SHALL gain it
- **AND** `A`'s `lastSeenAt` SHALL be updated to `Date.now()`
- **AND** the perceived switch SHALL appear instant (no `starting ttyd…` loader, no terminal redraw)

#### Scenario: LRU eviction at cap

- **GIVEN** `MANAGE_TMUX_CACHE_CAP = 4` and the user has selected rows `A`, `B`, `C`, `D` in that order — all four are cached and `D` is currently visible; `A` is the LRU entry
- **WHEN** the user selects a fifth row `E` whose sessionName is not in the cache
- **THEN** `A`'s cache entry SHALL be removed from the cache map
- **AND** `A`'s `<TerminalView>` SHALL unmount (its iframe, WebSocket, and xterm state are destroyed)
- **AND** the server SHALL observe `A`'s WebSocket close (via `noteWsDisconnect`)
- **AND** a fresh cache entry SHALL be created for `E` and its `<TerminalView>` SHALL mount, firing the standard `start`/`attach` POST for `E`
- **AND** `E` SHALL be the visible entry; `B`, `C`, `D`, `E` are now in the cache (size = 4)

#### Scenario: First selection mounts and adds to cache

- **GIVEN** the page just loaded with no `?session=` param and the cache is empty
- **WHEN** the user clicks row `X` for the first time
- **THEN** a fresh `<TerminalView>` SHALL mount for `X` and POST the appropriate `start` or `attach` endpoint
- **AND** the cache contains exactly one entry: `X` with `lastSeenAt = Date.now()`

#### Scenario: Selected entry is never LRU-evicted

- **GIVEN** the cache is at cap with `A`, `B`, `C`, `D` and `A` is currently selected
- **WHEN** the user selects a fresh row `E`
- **THEN** the LRU eviction targets the entry with the oldest `lastSeenAt` AMONG THE NON-SELECTED ENTRIES (i.e. the eviction picks from `{B, C, D}`, not `A`)
- **AND** `A` remains in the cache after the selection completes

#### Scenario: Killing a cached session removes it from the cache

- **GIVEN** rows `A`, `B`, `C` are cached and `B` is currently selected
- **WHEN** the user clicks `Kill` on row `A` and the kill mutation succeeds
- **AND** the next `GET /api/tmux-sessions` refetch returns a list without `A`
- **THEN** `A`'s cache entry SHALL be removed from the cache map
- **AND** `A`'s `<TerminalView>` SHALL unmount
- **AND** `B` remains visible; `C` remains in the cache (hidden)

#### Scenario: Renaming a cached session drops the old cache entry

- **GIVEN** row `memon-manual-old` is cached and currently selected; the rename dialog is opened on it; the user submits `memon-manual-new`
- **WHEN** the rename mutation succeeds
- **THEN** the old cache entry under `memon-manual-old` SHALL be removed from the cache map
- **AND** the page's URL SHALL update to `?session=memon-manual-new` via `router.replace` (existing rename behaviour)
- **AND** the new sessionName `memon-manual-new` SHALL be inserted into the cache as a fresh entry on the post-URL-update render — its `<TerminalView>` mounts and POSTs `attach` for the new name
- **AND** the cache size SHALL be unchanged (one entry replaced by another)

#### Scenario: Cache survives a refetch that does not change session set

- **GIVEN** rows `A`, `B`, `C` are cached and `A` is currently selected
- **WHEN** the 5-second `/api/tmux-sessions` refetch fires and the response still contains `A`, `B`, `C` (no add, no remove)
- **THEN** the cache SHALL be unchanged — same three entries, same instances, same `lastSeenAt` values
- **AND** no `<TerminalView>` SHALL re-mount

#### Scenario: Empty-state coexists with cached entries

- **GIVEN** rows `A`, `B` are cached and `A` is currently selected
- **WHEN** the user clicks the same row `A` a second time so that the page implementation toggles to no selection (or a future affordance clears the selection by other means)
- **THEN** the right pane SHALL render the `RightPaneEmpty` placeholder
- **AND** `A` and `B` SHALL remain in the cache, both with the `hidden` class on their containers
- **AND** subsequently selecting `A` again SHALL be a cache hit (no fresh `start`/`attach` fires)

NOTE: the current `/manage/tmux` UI does not expose a "deselect"
gesture; this scenario is preserved as a guarantee for any future
deselect affordance.

### Requirement: Cross-page release of cached TerminalView via BroadcastChannel

`TmuxManagePageClient` SHALL subscribe to a same-origin
`BroadcastChannel` named `memon:terminal-attached` for the lifetime
of the page mount. Each message SHALL carry the shape:

```ts
type AttachedMessage = {
  sessionName: string
  source: 'manage' | 'drawer' | 'popup' | 'unknown'
  attachedAt: number  // Date.now() millis since epoch
}
```

On each incoming message:
- If `BroadcastChannel` is not supported by the current browser
  (`typeof BroadcastChannel === 'undefined'`), the subscribe step
  SHALL be skipped — the cache continues to operate via LRU only.
- If `msg.sessionName === selectedName` (the manage page's
  currently-selected row), the message SHALL be a no-op.
- Else if `msg.sessionName` IS a key in the cache (a cached but not
  currently-selected entry), the cache entry SHALL be removed and
  its `<TerminalView>` SHALL unmount.
- Else the message SHALL be a no-op.

The page SHALL NOT filter incoming messages on `source`. The
`source` field is for telemetry / debugging only.

The page SHALL clean up the channel subscription on unmount
(`channel.close()` in the effect cleanup).

Coexistence with same-tab self-broadcasts: when the page selects a
fresh row whose `<TerminalView>` mounts and broadcasts `{ sessionName:
'X', source: 'manage' }`, the listener SHALL evaluate the message
AFTER `selectedName` has been updated to `'X'`. The "no-op when
selected" rule then fires and no eviction happens. Implementations
MUST guarantee this ordering — typically by reading `selectedName`
inside the listener via a ref or re-creating the listener whenever
`selectedName` changes.

#### Scenario: Popup attach releases a cached non-selected entry

- **GIVEN** rows `A` and `B` are cached on `/manage/tmux`; `A` is currently selected; `B` is in the cache (hidden)
- **AND** the user opens row `B` in a popup window (clicks the per-row Popup button)
- **WHEN** the popup's `<TerminalView>` enters the `ready` phase and broadcasts `{ sessionName: 'B', source: 'popup', attachedAt: <now> }` on `memon:terminal-attached`
- **THEN** the manage page's listener SHALL receive the message
- **AND** because `B !== selectedName ('A')` and `B` is in the cache, the cache entry for `B` SHALL be removed
- **AND** `B`'s `<TerminalView>` on the manage page SHALL unmount, closing its WebSocket
- **AND** subsequently selecting `B` on the manage page SHALL be a fresh mount (cache miss) that POSTs `start`/`attach` for `B` again — the popup's ttyd is shared via the manager's idempotent return, so no duplicate ttyd process is spawned

#### Scenario: Selected entry is never released by broadcast

- **GIVEN** row `A` is currently selected on `/manage/tmux` (the right pane shows A's iframe)
- **WHEN** the user opens row `A` ALSO in a popup window and the popup broadcasts `{ sessionName: 'A', source: 'popup', ... }`
- **THEN** the manage page's listener SHALL evaluate `msg.sessionName === selectedName ('A')` as true
- **AND** the cache entry for `A` SHALL NOT be removed
- **AND** the right pane continues to show `A`'s iframe (no flicker, no reattach)
- **AND** both the manage page's iframe and the popup's iframe co-attach to the same backend ttyd via shared `wsConnections`

#### Scenario: Drawer attach releases a cached non-selected entry

- **GIVEN** the manage page caches rows `A` (selected) and `B` (hidden)
- **AND** the user opens the global terminal drawer for row `B` from a non-manage page in another tab
- **WHEN** the drawer's `<TerminalView>` enters `ready` and broadcasts `{ sessionName: 'B', source: 'drawer', ... }`
- **THEN** the manage page in the first tab SHALL drop `B` from its cache

#### Scenario: Self-broadcast from the manage page does not evict its own selection

- **GIVEN** the cache is empty and the user clicks row `C` for the first time
- **WHEN** `C`'s newly-mounted `<TerminalView>` enters `ready` and broadcasts `{ sessionName: 'C', source: 'manage', ... }` (the page's own listener receives this self-broadcast)
- **THEN** the listener SHALL evaluate `msg.sessionName === selectedName ('C')` as true (selection updated before broadcast under the ordering guarantee)
- **AND** the cache entry for `C` SHALL NOT be removed
- **AND** `C` remains visible

#### Scenario: Two manage-page tabs coordinate via broadcast

- **GIVEN** tab `T1` has cached `A` (selected), `B` (hidden); tab `T2` has cached `B` (selected), `A` (hidden)
- **WHEN** in tab `T1` the user selects `C` (a fresh row), causing `T1` to broadcast `{ sessionName: 'C', source: 'manage', ... }`
- **THEN** in tab `T2`, `C` is NOT cached, so the broadcast is a no-op for `T2`
- **AND** in tab `T2`'s subsequent selection of `B`, `T2` broadcasts `{ sessionName: 'B', source: 'manage', ... }` — but `B` IS the selectedName in `T2`, so `T2`'s self-broadcast is a no-op for `T2`
- **AND** in tab `T1`, the listener sees `B` in the cache and `B !== selectedName ('A')`, so `T1` evicts `B` from its cache

#### Scenario: BroadcastChannel unavailable falls back to LRU only

- **GIVEN** the page is loaded in a browser where `typeof BroadcastChannel === 'undefined'`
- **WHEN** the page mounts
- **THEN** no channel subscription SHALL be attempted (no `new BroadcastChannel(...)` call)
- **AND** the cache continues to operate — LRU eviction still fires at cap, kill / rename eviction still fires
- **AND** no error SHALL be thrown and no console warning SHALL block the page render

#### Scenario: Channel subscription is cleaned up on unmount

- **GIVEN** the user is on `/manage/tmux` and the channel listener is registered
- **WHEN** the user navigates away (route change unmounts `TmuxManagePageClient`)
- **THEN** the effect cleanup SHALL call `channel.close()` so no further messages reach the now-unmounted page
