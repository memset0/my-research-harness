## Context

`/manage/tmux` mounts a single `<TerminalView key={selectedName} ...>`
inside its right pane. The `key` is the per-row sessionName, so every
selection change re-mounts the component:

1. The previous `<TerminalView>` unmounts → its iframe is removed →
   the WebSocket to ttyd closes (`noteWsDisconnect` on the server,
   bumps `lastActiveAt`).
2. The new `<TerminalView>` mounts → its `useEffect` calls
   `startTerminal({ project, scope, slug, agent })` (matchable rows)
   or `attachTerminal({ sessionName })` (raw rows).
3. The server returns the existing entry (idempotent — sub-ms when
   the manager already holds the session) with the iframe URL.
4. The fresh `<iframe src={iframeUrl}>` mounts, ttyd serves its HTML,
   xterm initialises, the WebSocket opens, tmux client redraws, the
   browser paints the cursor.

Steps 1 + 4 are the bulk of the perceived 1–2s lag. The backend ttyd
process never died; the WebSocket and the xterm DOM both did. If we
keep the iframe alive across selection changes, switching back is one
CSS visibility flip — no network call, no terminal redraw.

Constraints:

- The cache is per-page. The component tree under `TmuxManagePageClient`
  owns it; navigating away unmounts everything (same as today). We do
  NOT try to persist iframes across route changes.
- The backend already supports multiple WebSocket clients per session
  (popup + drawer can co-attach today). Our cache simply keeps N
  WebSocket clients open from the same browser tab; the backend
  treats them as additional connections.
- The cache must NOT prevent the user from observing kill / rename
  effects. Server truth wins; cache reflects it.

## Goals / Non-Goals

**Goals:**

- Switching back to a recently-visited session on `/manage/tmux` is
  effectively instant (<50ms perceived; no fresh WebSocket
  handshake, no xterm reinit, no fresh ttyd HTTP fetch).
- Caps at a small frontend-side count (default 4) so a user who
  cycles through ten rows doesn't accumulate ten live iframes.
- Recently-used cache stays alive even when the row is not selected;
  the backend's idle-TTL killer effectively can't reap a cached
  session because the WebSocket holds `lastActiveAt` warm. (This is
  a desired side-effect, not a separate feature.)
- A cached, non-selected entry is dropped when the same session is
  attached elsewhere (popup, drawer, other tab) so we don't keep a
  duplicate WebSocket open for a window the user has clearly
  migrated away from.

**Non-Goals:**

- Persisting the cache across route changes. The user navigating
  away from `/manage/tmux` is allowed to lose all cached iframes.
- Prefetching iframes on row hover. The cache is populated reactively
  on first selection.
- Cross-device cache release. If a user opens session X on their
  phone while a desktop manage page caches it, the desktop cache is
  not released — `BroadcastChannel` is same-origin within one user
  agent. A server-side SSE topic would be needed; deferred.
- Configurable cap. Cap is hardcoded constant `MANAGE_TMUX_CACHE_CAP
  = 4` for now. If a user reports the default is wrong we'll add a
  knob.
- Backend changes. The manager, idle-TTL killer, LRU eviction,
  port allocator, and proxy server stay as-is.

## Decisions

### Cache representation: stack of mounted iframes, only the selected one visible.

The right pane renders an absolutely-positioned container whose
children are one `<TerminalView>` per cached sessionName. The
selected child gets `block`; the rest get `hidden` (Tailwind utility
that sets `display: none`). `display: none` removes the child from
the layout but PRESERVES iframe state — the WebSocket stays open,
the xterm DOM stays mounted, tmux client state is undisturbed.

Alternative considered: `visibility: hidden` (off-screen positioning,
or `opacity: 0 + pointer-events: none`). All preserve iframe state.
`display: none` was picked because it also skips paint/layout for the
hidden iframe, which matters when 4 ttyd terminals each animate a
cursor. The trade-off — `display: none` causes a brief reflow when
toggled — is invisible at 60fps for full-pane iframes.

Alternative rejected: keep the `<TerminalView>` mounted but swap
`<iframe>` `src` between sessions. Doesn't work — `<iframe>` `src`
change reloads the document and we lose state.

### Cache key: sessionName.

The right pane already has the row record (`TmuxSessionRow`) which
includes `sessionName`. The cache map is `Map<sessionName, {
lastSeenAt: number }>`. The cached `<TerminalView>` is keyed
identically (so React preserves the component instance).

The `(project, scope, slug, agent)` quartet is NOT used as the cache
key because raw-mode (manual) rows don't have those fields. The
sessionName works for both modes.

### Cap = 4, LRU eviction.

The cap is a tradeoff between memory (each iframe is ~5–15MB of JS
heap + xterm canvas) and the marginal value of caching one more.
Empirically users on `/manage/tmux` cycle between 2–3 active
sessions. Four covers the common case without thrashing; six would
double the per-page memory for marginal gain.

LRU = least-recently-SELECTED. `lastSeenAt` is updated whenever
`selectedName` changes to that entry's key. When a fresh selection
would push the cache past the cap, we drop the entry with the oldest
`lastSeenAt`. The currently-selected entry is never evicted (its
`lastSeenAt` was just updated).

### Eviction triggers besides LRU:

1. **Row disappears from server.** On `/api/tmux-sessions` refetch,
   if a cached sessionName is no longer in the list, drop it.
2. **Row killed via the page's Kill action.** The mutation already
   redirects away from the killed session; the cache cleanup follows
   from (1) on the next refetch. We could be more aggressive and
   drop on mutation success, but the (1) path covers it within ~5s.
3. **Row renamed.** The rename mutation updates the URL to the new
   name. Cache: drop the old name, optionally pre-allocate the new
   name's entry (so the post-rename selection lands on a cached
   entry). The simpler path is to just let the new name be a fresh
   selection and accept one iframe boot — the rename action already
   tears down the backend ttyd in the rename endpoint
   (`stopSession(oldName)` per the rename change), so re-attach is
   inevitable. We pick the simpler path.
4. **BroadcastChannel release.** Detailed below.

### Cross-page release via BroadcastChannel.

Channel name: `memon:terminal-attached` (one global channel for the
dashboard).

Message shape:
```ts
type AttachedMessage = {
  sessionName: string
  source: 'manage' | 'drawer' | 'popup' | 'unknown'
  attachedAt: number  // Date.now(), millis since epoch
}
```

`<TerminalView>` posts a message after its iframe enters the `ready`
phase (i.e. after the `start`/`attach` POST resolves and we have a
sessionName to broadcast). It posts ONCE per mount; the new
`source` prop is threaded through from the call site
(`source="manage"` for the manage right pane,
`source="drawer"` for `terminal-drawer-provider.tsx`,
`source="popup"` for `terminal-popup-client.tsx`, default
`"unknown"`).

`TmuxManagePageClient` subscribes via
`new BroadcastChannel('memon:terminal-attached')` and on each
incoming message:

- If `msg.sessionName === selectedName` → no-op. The right pane
  IS the attachment for this sessionName; we keep showing it. Even
  if a popup also opens the same sessionName, two co-attachments are
  fine.
- Else if the cache contains `msg.sessionName` → drop that cache
  entry. The cached iframe unmounts; its WebSocket closes; the
  backend's `wsConnections` decrements. Slot freed.
- Else → no-op.

The broadcast covers the same-origin tab/window case (popup,
drawer in another tab). It does NOT cover cross-device. We
intentionally keep this client-side — adding a server SSE topic
would solve cross-device but adds backend state and server →
client fan-out we don't need today.

Self-broadcast loops: when the manage page selects a session, its
own right-pane `<TerminalView>` will broadcast. The listener filter
"`msg.sessionName === selectedName` is no-op" makes this safe.

### Suppress the manage page's own broadcast for selection changes within the cache.

A subtle case: user clicks row B (cached). The right pane swaps
visibility from A → B. The cached `<TerminalView>` for B is already
mounted (its iframe is alive); we do NOT re-mount it, so its
`ready`-phase `useEffect` does NOT fire again, and no fresh
broadcast happens. Good — no spurious broadcast on cache-hit.

If the manage page selects a fresh session C (not in cache), C's
fresh `<TerminalView>` mounts, its `start`/`attach` resolves, and it
broadcasts `{ sessionName: 'C', source: 'manage' }`. Other tabs (or
the popup) seeing this broadcast and holding C in their own cache
would release it. That's exactly the desired symmetry.

### TerminalView source prop is opt-in (default `'unknown'`).

Existing call sites that don't pass `source` get the safe default.
We update the three known call sites in this change; future call
sites can opt into a meaningful source as they're added. The
listener doesn't filter on `source` — the discriminator is for
debugging / telemetry only.

### No backend acknowledgement.

The backend has no view of who's holding which iframe. The cache is
a frontend abstraction; the backend just sees N WebSocket clients
per session and applies its own LRU + idle-TTL rules. This is
deliberate — adding a "release session" backend endpoint would
duplicate the WebSocket close signal.

## Risks / Trade-offs

[Risk] N iframes' worth of xterm + ttyd JS in the manage page's tab
inflates memory. → Mitigation: cap at 4 with LRU. Each iframe is
on its own port so they don't share a renderer process; in Chromium
each is a separate site instance. Realistic worst case: 4 iframes ×
~12MB ≈ 50MB of extra heap when fully cached, vs. the ~15MB of a
single iframe today. Acceptable for a power-user dashboard.

[Risk] A cached session that's been idle in the cache for hours
silently keeps its WebSocket open, holding the backend ttyd alive
past its `ttyd_idle_ttl_minutes`. → Intended behaviour, not a risk.
The user explicitly opened this row recently (it's in the cache);
keeping the ttyd warm is the whole point. When the user closes the
manage page tab the cache vacates and the backend's idle-TTL killer
takes over.

[Risk] BroadcastChannel is unsupported in older browsers
(Safari < 15.4, IE). → Mitigation: `typeof BroadcastChannel !==
'undefined'` guard. When unsupported, the cache still works; only
the cross-page release feature is disabled. The user falls back to
LRU eviction. Acceptable degradation.

[Risk] Two manage-page tabs open simultaneously could thrash via
broadcast — tab A selects X (broadcast → tab B drops cache entry
for X), then tab B selects X (broadcast → tab A drops cache entry
for X), forever. → Doesn't happen because the listener filter
"`msg.sessionName === selectedName` is no-op" excludes the SELECTED
entry; only cached-but-not-selected entries are dropped. Tab A's
cache entry for X is the SELECTED one when tab B broadcasts; no
drop. No oscillation.

[Risk] `display: none` on iframes causes occasional repaint flickers
when toggling (browser-specific). → If the flicker is observable in
testing, swap to `position: absolute; visibility: hidden` for
non-selected entries (also preserves state, no display-toggle
reflow). Make the call during verification.

[Risk] Spec drift: the existing `tmux-session-management` spec says
the right pane mounts a single `<TerminalView key={sessionName}>`.
The new behaviour mounts up to N. → Mitigation: this change ships a
MODIFIED delta to the relevant requirement scenario (right-pane
attachment behavior).

[Risk] A user reports the cap (4) doesn't fit (e.g. they
genuinely cycle 6 sessions). → Mitigation: expose
`MANAGE_TMUX_CACHE_CAP` as an exported constant from the page
module so a follow-up change can bump it without a refactor. If a
user-facing knob is needed, that's a separate change.

## Migration Plan

UI-only change, no backend, no data migration. Ship in a single
deploy. Rollback is a revert of the four code files.

The change is invisible to existing UX patterns — single-row
selection still works, kill / rename still work, popup still works.
The only observable difference is "switching back to a row I
visited recently is much faster".

## Open Questions

None that block implementation. The cap value (4) and the
`display: none` vs `visibility: hidden` choice are reversible
without spec changes.
