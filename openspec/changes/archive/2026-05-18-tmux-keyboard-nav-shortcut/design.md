## Context

`/manage/tmux` already supports click-driven row selection through a
URL-routed pattern:

- `LeftPane` renders a `visible` array of `TmuxSessionRow` cards
  (filtered by the `All | Active | Stale` tab, ordered by the stable
  client-side `orderedAll` snapshot).
- A card click calls `onSelect(sessionName)` → `writeSelection(name)`
  → `router.replace('/manage/tmux?session=<name>')`.
- The URL `?session=` param is the single source of truth for the
  selection; the right-pane LRU cache mounts a `<TerminalView>` for
  each cached entry and toggles visibility based on `selectedName`.

Keyboard navigation needs to plug into the same `writeSelection`
pipeline so that the right pane reacts identically to clicks. There
is no existing global shortcut layer in the app — page-local
shortcuts are appropriate (and consistent with the user's stated
preference to wait until 2–3 shortcuts before extracting a shared
hook).

The page already has three modal dialogs (Kill / Rename / Create).
At least one (Rename) places focus in an `<Input>` where users may
press `Ctrl+Shift+Up` to extend the OS-level text selection; that
default behavior must not be hijacked.

## Goals / Non-Goals

**Goals:**
- Move selection by one row up/down within the current `visible`
  list using `Ctrl+Shift+ArrowUp` / `Ctrl+Shift+ArrowDown`.
- Reuse the existing URL-routed selection flow verbatim (no parallel
  state machine).
- Clamp at list bounds; bootstrap onto the first visible row when
  no selection exists yet.
- Scroll the newly-selected card into view automatically when the
  selection changes via the keyboard.
- Suppress the shortcut while focus is in editable text, while any
  modal dialog is open, or while the page is otherwise off the
  reader's attention (window blurred is fine — we don't try to
  detect that; the keydown only fires when the document has focus
  anyway).

**Non-Goals:**
- A reusable cross-page shortcut framework. This change is scoped
  to `/manage/tmux` only.
- Cross-pane navigation (e.g. moving focus into the right-pane
  iframe via keyboard). Out of scope; the iframe is opaque to
  outer keystrokes.
- Filter-tab navigation via keyboard. Not requested; trivially
  addable later under the same scheme.
- Wrap-around / cycling at list boundaries. The user explicitly
  framed the feature as "next adjacent window", so a hard clamp
  matches expectations better than wrap.
- Mac-specific bindings (`Cmd+Shift+Arrow`). The user requested
  `Ctrl+Shift`; on macOS that maps to the literal Control key. If
  later the user wants `Meta+Shift` too, that's a one-line
  addition.

## Decisions

### D1. Page-local effect, not a shared provider

The handler is a `useEffect` inside `TmuxManagePageClient` that
attaches a single `window.addEventListener('keydown', handler)` and
removes it on cleanup. Pros:

- Lifecycle is bound to the page client → no risk of leaking
  listeners into other routes.
- Reads `visible`, `selectedName`, dialog-open booleans, and the
  `writeSelection` closure directly from the component's scope;
  no prop drilling.

Alternative considered: a `useShortcut(key, handler)` hook in
`apps/web/lib/`. Rejected for **now** under the
[[feedback_propose_apply_loop]] convention — extract after the
second or third concrete shortcut lands, not pre-emptively.

### D2. Neighbor resolution is a pure helper, exported for tests

A pure function lives next to the component:

```ts
export function resolveNeighbor(
  list: readonly { sessionName: string }[],
  selected: string | null,
  direction: 'up' | 'down',
): string | null {
  if (list.length === 0) return null
  if (selected === null) return list[0]!.sessionName
  const idx = list.findIndex((r) => r.sessionName === selected)
  if (idx < 0) return list[0]!.sessionName
  if (direction === 'down') {
    if (idx >= list.length - 1) return null   // clamp at bottom
    return list[idx + 1]!.sessionName
  }
  if (idx <= 0) return null                   // clamp at top
  return list[idx - 1]!.sessionName
}
```

Returning `null` from the helper means "no change" (clamped or
empty list). The keydown handler interprets `null` as a no-op and
does NOT call `preventDefault()` in that case, letting the OS / app
default play out.

This shape matches the existing `applySelectionToCache` helper
already exported from the same file for tests, so the test harness
pattern is already in place.

### D3. Modifier semantics: literal `Ctrl+Shift`, NOT Mac-cmd-rewrite

The check is:

```ts
event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey
  && (event.key === 'ArrowDown' || event.key === 'ArrowUp')
```

- Allowing `event.metaKey` (Mac Cmd) would conflict with the OS
  shortcut for window-zoom on some setups; require the user to opt
  in if they want that.
- Allowing `event.altKey` would catch macOS option-arrow which can
  reorder words in text fields; exclude.

### D4. Suppression conditions

Suppress (i.e. early-return BEFORE preventDefault) when:

1. The event target is an editable element:
   ```ts
   const t = event.target as HTMLElement | null
   if (t && (t.matches('input, textarea, select') || t.isContentEditable)) return
   ```
2. Any of the three dialog states is open: `killTarget !== null`,
   `renameTarget !== null`, or `createOpen === true`. Reading these
   directly from the component scope is fine; the effect re-runs
   when they change and the listener is reattached with the fresh
   closure.

The `Sheet` / `Dialog` shadcn primitives DO render their content
into a portal, but the focused input still has standard `<input>`
DOM, so check #1 catches typing-in-dialog. Check #2 is a belt-and-
suspenders guard in case a dialog button (not an input) has focus.

### D5. Scroll-into-view on keyboard-driven change

When the helper returns a new sessionName, we set the URL via
`writeSelection`. To make the visually-selected card visible after
selection changes, we look up the card by `data-session-name`
attribute (added to the card root) and call
`element.scrollIntoView({ block: 'nearest', behavior: 'smooth' })`.

Implementation note: the URL change runs `router.replace`, which is
synchronous on the React side — the re-render swaps the
`border-primary` class onto the new card. We schedule the
`scrollIntoView` via `queueMicrotask` (or `requestAnimationFrame`)
so we read the post-render position. `block: 'nearest'` is
intentional: if the row is already on-screen it does nothing
(quiet UX). The behavior `'smooth'` is overridden to `'auto'` for
users with `prefers-reduced-motion: reduce` to match accessibility
expectations.

### D6. No focus follow

We do NOT call `.focus()` on the card. The card is keyboard-
selected but document focus remains where it was (typically on the
page body or wherever a prior `Tab` ring left it). Rationale:

- Calling `.focus()` would trigger the card's `focus-visible:ring`
  outline, which is visually noisy when the user expects nothing
  more than a selection change.
- The user can already `Tab` into the card normally; keyboard nav
  is an orthogonal "set selection" operation, not a focus shift.
- If the user needs to operate per-row buttons (Kill / Rename),
  they'll click or `Tab` into them. The shortcut does not try to
  short-circuit that.

### D7. Forward keys from the ttyd iframe to the parent window

The right-pane terminal is an `<iframe src="/api/terminal/proxy/
<sessionName>/">`. The proxied URL shares origin with the parent
app (the Next.js server reverse-proxies to a loopback ttyd port),
which means same-origin scripting access is available: the parent
can attach DOM event listeners on `iframe.contentDocument`.

Without this forwarding, the parent's `window.addEventListener
('keydown', ...)` is dead the moment the user clicks into the
terminal — the iframe owns focus and xterm.js's keydown handlers
consume the event. The shortcut would be advertised but only work
when the user clicks somewhere outside the iframe first. That's
the bug the user surfaced post-ship.

**Mechanism.** In `TerminalView`, when `source === 'manage'` and
the iframe has loaded:

1. Read `iframe.contentDocument` AND `iframe.contentWindow`.
   Same-origin, so both are non-null and readable. Wrapped in
   try/catch to fail closed on the rare chance the iframe loads
   cross-origin (e.g. a future reverse-proxy mis-configuration).
2. **Reject the placeholder `about:blank` document.** When an
   iframe is inserted with a `src`, browsers expose an initial
   `about:blank` document synchronously (`readyState === 'complete'`,
   `URL === 'about:blank'`) before the real navigation finishes.
   Attaching there orphans the listener the moment the real
   document replaces it. The implementation checks
   `doc.URL === 'about:blank'` and rejects.
3. Attach `'keydown'` with `{ capture: true }` on BOTH
   `iframe.contentWindow` and `iframe.contentDocument`. Capture
   order is `window → document → ... → target`, so window-capture
   fires first and document-capture is the backup. Capture beats
   every listener inside the iframe (xterm.js's keydown is on
   the helper textarea, which is the target phase).
4. In the handler, call the shared matcher
   `isManageTmuxNavShortcut(event)`. If false, return (let xterm
   handle the key normally — important so the terminal still
   sees every other key).
5. If true, `event.preventDefault()`, `event.stopPropagation()`,
   and `event.stopImmediatePropagation()` so xterm does NOT
   receive the event and ttyd does NOT forward it over WebSocket
   to the underlying tmux/agent. Per the DOM dispatch algorithm,
   `stopPropagation()` set during a capture-phase listener
   prevents the event from reaching the target phase — so the
   textarea's listener does not fire even though the textarea is
   the original event target.
6. Dispatch a synthesized `new KeyboardEvent('keydown', { ... })`
   onto the **parent** `window` (captured by closure, not the
   iframe's window). The parent's existing handler matches
   modifiers + key, then navigates.
7. **Both eager and load-driven attach.** Register a `'load'`
   event listener on the iframe AND attempt one eager
   synchronous attach inside the `useEffect` body. The `'load'`
   handler covers the common case (navigation completes after
   effect runs). The eager attach covers the rare case where the
   iframe finished loading before the effect mounted (we'd miss
   the `'load'` event entirely). The `about:blank` rejection
   makes the eager attempt a safe no-op when the navigation is
   still in flight.
8. **Drop stale attachments on re-attach.** If `tryAttach`
   succeeds against a fresh document while a prior attachment is
   still live, the old listener SHALL be removed before the new
   one is added so listeners do not stack across iframe re-loads.
9. On effect cleanup (iframe unmount, URL change, or source
   flip) remove all listeners via the closure's cleanup
   function.

**Why source-gated.** Drawer (`source: 'drawer'`) and popup
(`source: 'popup'`) usages of `<TerminalView>` have NO parent
navigation listener that would consume the synthesized event.
Forwarding in those contexts would simply steal the key with no
observable benefit, breaking any user expectation that
`Ctrl+Shift+Arrow` might be a terminal-program binding. Gating
on `source === 'manage'` keeps the forwarder scoped to the only
context where it matters.

**Re-dispatch shape.** The synthesized event has `target ===
window`. The parent's editable-element check (D4 #1) is
`target.matches('input, textarea, ...')`, which is `undefined`
on `window` — so the check short-circuits, NOT enters the
suppression branch, and the handler proceeds. This is what we
want: the user typing in the iframe is on xterm's textarea,
which is the terminal — NOT an HTML form input where we'd want
to preserve text-selection-extension semantics.

**Alternatives considered and rejected.**

- *Detect "iframe has focus" and refocus the parent body when
  user gestures move outside.* Would also need to track when the
  user starts typing in the iframe again; very fiddly, and would
  visibly steal focus.
- *Use `iframe.contentWindow.dispatchEvent` instead of capture-
  phase pre-emption.* Doesn't help — the underlying problem is
  that xterm gets the keydown first when focus is inside, not
  that we can't reach into the iframe. Capture is the right
  tool.
- *Rewrite the ttyd HTML in the proxy to inject our own script.*
  Equivalent end-state, but couples shortcut behavior to proxy
  internals and requires HTML rewriting (extra failure modes,
  cache-control nuances). The parent-side `contentDocument`
  approach is one-file, scoped to `/manage/tmux`, and has no
  effect on cached ttyd output.
- *Render xterm.js directly in the parent without an iframe.*
  Correct long-term answer but a much larger rewrite. Out of
  scope; track separately if the iframe approach grows pain.

**Shared matcher.** `isManageTmuxNavShortcut(event)` lives next
to `resolveNeighbor` in `tmux-page.client.tsx`. Both the parent
handler and the iframe forwarder import it, so the modifier
contract is enforced in exactly one place. Refactor cost:
trivial — the parent handler already had the same expression
inlined.

## Risks / Trade-offs

- **Risk:** Browsers handle `Ctrl+Shift+ArrowUp/Down` as a built-in
  text-selection-extension binding inside editable controls. If
  the suppression check (D4 #1) misses something exotic (e.g. a
  Monaco-embedded editor in a future page), the shortcut could
  steal the keypress.
  **Mitigation:** the suppression check covers `input`, `textarea`,
  `[contenteditable]`, and `select`. No Monaco/CodeMirror is on
  `/manage/tmux` today. If one lands later, the check can be
  widened.

- **Risk:** When the visible list re-snapshots (new session appears)
  between the user's key press and the URL update, the resolved
  neighbor might be off by one.
  **Mitigation:** The handler reads `visible` from the closure at
  event time; this is the exact same list the user was looking at.
  React's render cycle guarantees no torn read. The 5s refetch
  doesn't reorder existing rows (covered by the existing "Stable
  client-side ordering" requirement), so the worst case is a new
  row appearing at the end after the user has already started
  navigating — which is the desired behavior.

- **Trade-off:** Clamp vs wrap. Clamp avoids surprising "next press
  jumped to the top" behavior at the cost of forcing the user to
  reach for the mouse / `Home` (not implemented) if they want the
  other end of a long list. Wrap is one-line to add later.

- **Trade-off:** Hard-coded modifier vs configurable. We bake in
  `Ctrl+Shift+Arrow`. If the user later wants a different binding,
  it's a code change. Acceptable given the current single-user
  threat model and the absence of any other config surface for
  shortcuts.

- **Risk:** Same-origin assumption for the ttyd iframe. The
  forwarder relies on `iframe.contentDocument` being readable.
  If `/api/terminal/proxy/...` ever moves to a different origin
  (e.g. a sub-domain split for cookie isolation), the forwarder
  will silently no-op (try/catch swallows the cross-origin
  SecurityError). The parent shortcut still works as long as
  focus is outside the iframe.
  **Mitigation:** none beyond the silent no-op. The current
  reverse-proxy design (same Next.js port handles both the app
  HTML and the ttyd proxy path) makes a cross-origin move
  unlikely without a deliberate spec change, at which point this
  design would be revisited.

- **Trade-off:** Pre-empting Ctrl+Shift+Arrow inside the
  terminal removes that combo as a terminal-program binding. If
  the user's CLI (claude / codex / shell) ever wants to use
  Ctrl+Shift+Arrow for its own purposes inside `/manage/tmux`,
  they'd lose access while in that view. None of the agents we
  currently embed bind it, and `/manage/tmux` is a management
  view where session-nav is a higher priority than terminal
  bindings; acceptable.

## Migration Plan

No data migration. No backwards-compatibility concern — the
behavior is purely additive. Rollback is a code revert.

## Open Questions

None. The user's directive is clear; the page architecture is
straightforward to extend.
