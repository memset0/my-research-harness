## Why

Switching between rows on `/manage/tmux` re-mounts the right-pane
`<TerminalView>` because its `key` is the row's `sessionName`. Every
re-mount tears the iframe down (closing the WebSocket to ttyd) and
spins up a fresh one — even when the user is just toggling between two
sessions they had open seconds ago. The end-to-end cost per switch is
~1–2s of perceived lag (POST `/api/terminal/start|attach` → iframe
JS init → ttyd handshake → tmux client redraw), which makes
multi-session work on this page feel sluggish.

The expensive parts are entirely on the frontend: the backend ttyd is
already alive (the manager's idempotent return is sub-millisecond), but
the iframe + WebSocket + xterm boot has to repeat each time. Keeping
the iframe alive across selection changes makes the switch instant.

## What Changes

- **`/manage/tmux` right pane caches recently-selected ttyd iframes.**
  Replace the single `<TerminalView key={selectedName} ...>` mount with
  an absolutely-positioned stack of cached `<TerminalView>` instances.
  The currently-selected entry is visible (`block`); all other cached
  entries remain mounted under `hidden` so their WebSocket + xterm
  state survives. Switching back to a cached session is one CSS flip
  with no network round-trip and no terminal redraw.
- **Cache cap = 4 (default), LRU eviction.** When a fresh selection
  would push the cache past the cap, the least-recently-selected entry
  is unmounted. Cap is hardcoded for now; a config knob is out of
  scope until a user reports the default doesn't fit.
- **Cache eviction triggers** (besides LRU): the row is killed (server
  removes it from `/api/tmux-sessions` → next refetch); the row is
  renamed (the page already updates the URL to the new name — the old
  name is dropped from the cache and the new one inserted on first
  selection); the row disappears for any other reason.
- **Cross-page release via `BroadcastChannel`.** Every `<TerminalView>`
  instance (manage right-pane, drawer, popup) broadcasts
  `{ sessionName, source }` on the channel `memon:terminal-attached`
  when its iframe enters the `ready` phase. The manage page subscribes
  to that channel; when it receives a message for a sessionName that
  is in the cache AND is NOT the currently-selected entry, the cache
  drops that entry. The currently-selected entry is never released by
  this signal — the right pane stays attached even if the same
  session is also opened in a popup.
- **No backend changes.** The existing `/api/terminal/start`,
  `/api/terminal/attach`, manager LRU, idle-TTL killer, and ttyd-
  process lifecycle all stay as-is. The cache is purely a
  client-side optimisation; cached iframes hold their WebSockets open,
  which (correctly) keeps the backend's idle-TTL killer from reaping
  cached sessions until the cache lets them go.

Non-changes (out of scope):

- No persistence of the cache across route changes. Navigating away
  from `/manage/tmux` unmounts everything — same as today.
- No prefetch on hover. The cache is populated on first selection.
- No backend SSE topic for cross-device handoff. BroadcastChannel
  handles same-origin tabs/windows; cross-device handoff (open
  session on phone while desktop manage page caches it) is rare and
  not addressed by this change.
- No CLI surface or config knob.

## Capabilities

### New Capabilities

(None — this extends an existing capability.)

### Modified Capabilities

- `tmux-session-management`: the right-pane terminal mount semantics
  change from "single keyed `<TerminalView>`" to "cache of up to N
  `<TerminalView>` instances with LRU eviction and BroadcastChannel
  release"; eviction triggers and the cross-page release contract
  become spec-level rules.
- `browser-terminal`: every `<TerminalView>` instance broadcasts a
  `terminal-attached` event on a same-origin BroadcastChannel when
  its iframe enters the `ready` phase, so cache holders elsewhere can
  release their hold.

## Impact

- **Affected code**:
  - `apps/web/components/terminal-view.tsx` — emit a
    `BroadcastChannel('memon:terminal-attached')` post on iframe
    `ready`; payload includes the resolved `sessionName` (from the
    `start`/`attach` response, NOT a synthesised guess) and a
    `source: 'manage' | 'drawer' | 'popup' | 'unknown'` discriminator
    threaded through a new `source` prop.
  - `apps/web/app/manage/tmux/tmux-page.client.tsx` — replace the
    single right-pane `<TerminalView>` with a cache stack
    (`Map<sessionName, { lastSeenAt, key }>`), an LRU evictor at cap
    `4`, and a `BroadcastChannel` listener that drops non-selected
    cache entries on receipt. The `RightPane` component renders all
    cached views overlaid; only the selected one is visible.
  - `apps/web/components/terminal-drawer-provider.tsx` — pass
    `source="drawer"` to its `<TerminalView>` for the broadcast tag.
  - `apps/web/app/terminal-popup/terminal-popup-client.tsx` — pass
    `source="popup"` to its `<TerminalView>`.
- **Affected specs**: `openspec/specs/tmux-session-management/spec.md`
  (delta in this change at
  `specs/tmux-session-management/spec.md`),
  `openspec/specs/browser-terminal/spec.md` (delta at
  `specs/browser-terminal/spec.md`).
- **No SSE topic changes**. The release signal is purely client-side
  via `BroadcastChannel`.
- **No `FS_CONVENTION_VERSION` bump**. UI/runtime change only.
- **Test impact**: add a browser-level test (Playwright or
  jsdom-equivalent) covering: (1) cache-hit switch is instant
  (no `start`/`attach` POST fires the second time the same row is
  selected); (2) LRU eviction unmounts the right entry; (3) a
  BroadcastChannel post for a cached non-selected sessionName drops
  that entry; (4) a BroadcastChannel post for the currently-selected
  sessionName is a no-op.
