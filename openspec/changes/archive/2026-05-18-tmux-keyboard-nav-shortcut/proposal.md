## Why

`/manage/tmux` is the operator's hub for multiple long-running tmux
sessions (each carrying a Claude / Codex / opencode CLI or a shell).
The user typically opens this page in a side-by-side window next to
their terminal/editor and watches several sessions over the course of
a day. Today, switching the right-pane focus between sessions
requires reaching for the mouse and clicking a row card in the left
list — that round-trip breaks flow when checking on N parallel
agents.

Adding `Ctrl+Shift+Up` / `Ctrl+Shift+Down` to step through the
visible left-pane list lets the keyboard-bound user move between
sessions without leaving the home row.

## What Changes

### `/manage/tmux`: keyboard navigation between rows

- When the user is on `/manage/tmux` and presses
  `Ctrl+Shift+ArrowDown`, the selection moves to the **next** row in
  the currently-visible filtered list (the same list the cards
  render from). `Ctrl+Shift+ArrowUp` moves to the **previous** row.
- The handler updates the URL the same way clicking a card does
  (`router.replace('/manage/tmux?session=<name>')`), so the right
  pane re-focuses on the new selection via the existing cache
  machinery.
- Navigation is **clamped** at both ends: pressing Up while the
  first row is selected, or Down while the last row is selected,
  is a no-op (no wrap-around).
- Initial-press behavior when nothing is currently selected:
  - Down or Up while no row is selected → selects the **first**
    visible row. Both directions resolve the same way so the user
    never has to remember which key bootstraps.
- The newly-selected row is scrolled into view via
  `scrollIntoView({ block: 'nearest' })` so a long list doesn't
  hide the cursor below the fold.
- The shortcut is **suppressed** when keyboard focus is in a text
  input, textarea, or `contenteditable` element, OR when any modal
  dialog (Kill / Rename / Create) is open. This keeps the rename
  dialog's `Ctrl+Shift+Up` selection-extension behavior intact.
- The handler calls `preventDefault()` only when it actually
  changes the selection; otherwise the event propagates so default
  browser behavior is unaffected.
- The shortcut binds at the page-client level (effect on
  `TmuxManagePageClient`) and only attaches while that page is
  mounted; it does NOT leak to other routes.

### Shortcut forwarding from the embedded ttyd iframe

The right pane on `/manage/tmux` is a ttyd-rendered terminal in an
`<iframe>` served from `/api/terminal/proxy/<sessionName>/`. That
URL is **same-origin** with the parent app (the Next.js server
reverse-proxies to a loopback ttyd port), so the parent CAN attach
DOM event listeners on `iframe.contentDocument`.

Without that, once the user clicks into the terminal to type,
keyboard focus moves into the iframe and the parent `window`'s
`keydown` listener never sees `Ctrl+Shift+Arrow*` — xterm.js
inside ttyd swallows them. That makes the shortcut feel broken in
the most common workflow ("I was looking at the terminal pane;
now I want to peek at the next session").

This change additionally installs a capture-phase keydown listener
on `iframe.contentDocument` for every `<TerminalView>` rendered on
`/manage/tmux` (`source === 'manage'`). When the listener sees the
exact `Ctrl+Shift+ArrowUp/Down` combo, it `preventDefault()`s and
`stopPropagation()`s the event so xterm.js does NOT receive it,
then re-dispatches a synthesized `KeyboardEvent` of the same key
onto the parent `window`. The parent's existing handler catches
the synthesized event and runs the navigation.

Drawer / popup callers of `<TerminalView>` (`source` of `drawer` /
`popup` / `unknown`) do NOT install the forwarder — there's no
parent navigation listener to receive the event in those contexts,
and stealing the key with no observable effect would be worse than
leaving it for xterm.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `tmux-session-management`: adds a new requirement covering the
  keyboard-driven navigation between rows on `/manage/tmux`,
  alongside the existing click-to-select behavior.

## Impact

- `apps/web/app/manage/tmux/tmux-page.client.tsx` — add a
  `useEffect`-based global `keydown` listener on the page client
  that consults the `visible` list and current `selectedName`,
  computes the neighbor sessionName, and calls `writeSelection`
  for it. Also handle the scroll-into-view side-effect on the
  matched card. Export `resolveNeighbor` and
  `isManageTmuxNavShortcut` as pure helpers for shared use.
- `apps/web/components/terminal-view.tsx` — when `source ===
  'manage'`, attach a capture-phase keydown listener to
  `iframe.contentDocument` after the iframe loads. The listener
  matches Ctrl+Shift+ArrowUp/Down via `isManageTmuxNavShortcut`,
  `preventDefault()` + `stopPropagation()` the iframe event, and
  re-dispatches a synthesized `KeyboardEvent` onto the parent
  `window`.
- `apps/web/test/browser/manage-tmux-keyboard-nav.test.ts` —
  unit tests for `resolveNeighbor` and `isManageTmuxNavShortcut`.
- `openspec/specs/tmux-session-management/spec.md` — append the
  new requirement under "Modified Capabilities" delta covering
  both the parent-window handler and the iframe forwarder.

No new endpoints, no new dependencies, no schema changes.
