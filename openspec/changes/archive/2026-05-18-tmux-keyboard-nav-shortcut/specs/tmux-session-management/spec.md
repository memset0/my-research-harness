## ADDED Requirements

### Requirement: Keyboard navigation between session rows on /manage/tmux

The `/manage/tmux` page SHALL support keyboard-driven navigation
between rows in the left-pane session list. The bindings SHALL be
`Ctrl+Shift+ArrowDown` (move selection to the next row) and
`Ctrl+Shift+ArrowUp` (move selection to the previous row). The
navigation SHALL operate on the **visible** filtered list — the
same array of `TmuxSessionRow` values the left pane renders — and
SHALL drive selection through the same URL-routed flow as a click
on a card (`router.replace('/manage/tmux?session=<name>')`).

The modifier match SHALL require `ctrlKey === true` AND
`shiftKey === true` AND `altKey === false` AND `metaKey === false`.
Other modifier combinations SHALL leave the page's default keydown
handling untouched.

The shortcut SHALL be **suppressed** (the handler returns without
calling `preventDefault`) under any of the following:

- The event's target is an editable control: an `<input>`,
  `<textarea>`, `<select>`, or any element with
  `isContentEditable === true`.
- The Kill, Rename, or Create dialog is currently open.

When the shortcut is NOT suppressed, the page SHALL resolve the
next selection from the current visible list and the current
`?session=` URL value:

- If the list is empty, the shortcut is a no-op and SHALL NOT
  call `preventDefault()`.
- If no session is currently selected, both `ArrowDown` and
  `ArrowUp` SHALL select the **first** row in the visible list.
- If a session is selected and present in the visible list at
  index `i`:
  - `ArrowDown` with `i < list.length - 1` SHALL select index
    `i + 1`. `ArrowDown` with `i === list.length - 1` SHALL be a
    no-op (clamp at the bottom; no wrap-around).
  - `ArrowUp` with `i > 0` SHALL select index `i - 1`.
    `ArrowUp` with `i === 0` SHALL be a no-op (clamp at the top).
- If a session is selected but NOT in the visible list (e.g. the
  user switched filter tabs and the selected session is no longer
  visible), both `ArrowDown` and `ArrowUp` SHALL select the
  **first** visible row.

When the shortcut DOES change the selection, the page SHALL:

- Call `preventDefault()` on the keydown event so the browser's
  built-in text-selection-extension behavior does NOT also fire.
- Update the URL via `router.replace` (consistent with click-
  driven selection — no new history entry).
- Scroll the newly-selected card into view via
  `scrollIntoView({ block: 'nearest', behavior: 'smooth' })`.
  When the user agent reports `prefers-reduced-motion: reduce`,
  the page SHALL use `behavior: 'auto'` instead.

The page SHALL NOT call `.focus()` on the newly-selected card.
Selection and focus are independent: the card receives the
`border-primary` selected styling and the right pane re-mounts
its terminal, but document focus stays wherever it was before
the keypress.

The keydown listener SHALL be installed only while the
`TmuxManagePageClient` is mounted and SHALL be removed on
unmount, so the shortcut does NOT leak to other routes.

The shortcut SHALL also fire when keyboard focus is currently
inside the right-pane ttyd `<iframe>`. Because the iframe URL
(`/api/terminal/proxy/<sessionName>/`) is same-origin with the
parent app, `TerminalView` SHALL — when its `source` prop is
`'manage'` — install a `'keydown'` listener with
`{ capture: true }` on **both** `iframe.contentWindow` and
`iframe.contentDocument` after the iframe finishes loading.
Attaching on both targets defends against any iframe-internal
listener (xterm.js or otherwise) that might register at the
window level; the document attachment is the backup. Capture
phase ensures the listener fires before any target-phase
listener inside the iframe (xterm.js's keydown is on the helper
textarea, which is the target).

The attach point SHALL NOT be the placeholder `about:blank`
document that browsers expose synchronously for an iframe with
a freshly-set `src` (with `readyState === 'complete'` and
`URL === 'about:blank'`). That placeholder is replaced when the
real navigation completes, and any listener attached to it gets
orphaned silently. The implementation SHALL therefore:

- Reject any `contentDocument` whose `URL === 'about:blank'`
  or whose `readyState === 'loading'`.
- Register a `'load'` event listener on the iframe element and
  re-attempt the attach inside that handler, so the listener
  lands on the post-navigation document.
- Also attempt one eager (synchronous) attach inside the
  `useEffect` body, so the rare case where the iframe has
  already finished loading before the effect runs (e.g. cached
  content) is still covered. The `about:blank` rejection makes
  the eager attempt a safe no-op when the navigation is still
  in flight.
- When a re-attach succeeds, drop any prior attachment first so
  listeners do not stack across iframe re-loads. When that listener observes the exact
`Ctrl+Shift+ArrowUp/Down` combo:

- It SHALL call `event.preventDefault()`,
  `event.stopPropagation()`, and `event.stopImmediatePropagation()`
  on the iframe event so xterm.js does NOT receive the key and
  ttyd does NOT forward it over WebSocket to the underlying
  tmux/agent. Per the DOM dispatch algorithm, calling
  `stopPropagation()` in capture phase on the iframe's window
  prevents the event from reaching the target phase, so
  xterm.js's textarea listener does not fire.
- It SHALL dispatch a synthesized `KeyboardEvent('keydown', ...)`
  with the same `key`, `code`, `ctrlKey: true`, `shiftKey: true`,
  `altKey: false`, `metaKey: false`, `bubbles: true`,
  `cancelable: true` onto the **parent** `window`. The parent's
  page-level handler SHALL receive the synthesized event and run
  the navigation as if the user had pressed the keys with focus
  outside the iframe.

The forwarder SHALL pass through any keydown that does NOT match
Ctrl+Shift+ArrowUp/Down (no preventDefault, no stopPropagation,
no re-dispatch) so terminal-program input is unaffected.

The forwarder SHALL only be installed when `source === 'manage'`.
Other `<TerminalView>` callers (`source: 'drawer'`, `'popup'`, or
`'unknown'`) SHALL NOT install it.

The forwarder SHALL be removed when the iframe is replaced (URL
change, `source` change, or `TerminalView` unmount). Failure to
read `iframe.contentDocument` (e.g. unexpected cross-origin
configuration) SHALL be caught and treated as a silent no-op so
the parent-window shortcut still works when focus is outside the
iframe.

#### Scenario: Down arrow with selection moves to the next visible row

- **GIVEN** the visible list is `[A, B, C]` and the URL is
  `/manage/tmux?session=A`
- **WHEN** the user presses `Ctrl+Shift+ArrowDown`
- **THEN** the URL becomes `/manage/tmux?session=B` via
  `router.replace` (no new history entry pushed)
- **AND** the keydown event has `defaultPrevented === true`
- **AND** the row for `B` is scrolled into view if it was off-
  screen, and the left pane shows `B`'s card with the selected
  styling
- **AND** the right pane unmounts `A`'s `<TerminalView>` and
  mounts `B`'s

#### Scenario: Up arrow with selection moves to the previous visible row

- **GIVEN** the visible list is `[A, B, C]` and the URL is
  `/manage/tmux?session=C`
- **WHEN** the user presses `Ctrl+Shift+ArrowUp`
- **THEN** the URL becomes `/manage/tmux?session=B`
- **AND** the keydown event has `defaultPrevented === true`

#### Scenario: Down arrow clamps at the last row

- **GIVEN** the visible list is `[A, B, C]` and the URL is
  `/manage/tmux?session=C`
- **WHEN** the user presses `Ctrl+Shift+ArrowDown`
- **THEN** the URL remains `/manage/tmux?session=C`
- **AND** the keydown event has `defaultPrevented === false`
  (no wrap-around, no preventDefault)

#### Scenario: Up arrow clamps at the first row

- **GIVEN** the visible list is `[A, B, C]` and the URL is
  `/manage/tmux?session=A`
- **WHEN** the user presses `Ctrl+Shift+ArrowUp`
- **THEN** the URL remains `/manage/tmux?session=A`
- **AND** the keydown event has `defaultPrevented === false`

#### Scenario: Down arrow with no selection bootstraps onto the first visible row

- **GIVEN** the visible list is `[A, B, C]` and the URL is
  `/manage/tmux` (no `?session=` param)
- **WHEN** the user presses `Ctrl+Shift+ArrowDown`
- **THEN** the URL becomes `/manage/tmux?session=A`

#### Scenario: Up arrow with no selection bootstraps onto the first visible row

- **GIVEN** the visible list is `[A, B, C]` and the URL is
  `/manage/tmux` (no `?session=` param)
- **WHEN** the user presses `Ctrl+Shift+ArrowUp`
- **THEN** the URL becomes `/manage/tmux?session=A`

#### Scenario: Selected session missing from visible list re-bootstraps

- **GIVEN** the URL is `/manage/tmux?session=X` and the filter tab
  is `Active`, but `X` is a stale row that is filtered out so the
  visible list is `[B, D]`
- **WHEN** the user presses `Ctrl+Shift+ArrowDown` (or
  `ArrowUp`)
- **THEN** the URL becomes `/manage/tmux?session=B` (the first
  visible row)

#### Scenario: Shortcut suppressed while typing in the Rename dialog

- **GIVEN** the Rename dialog is open with its `<Input>` focused
  and the visible list is `[A, B, C]` with `?session=A`
- **WHEN** the user presses `Ctrl+Shift+ArrowDown`
- **THEN** the URL remains `/manage/tmux?session=A` (no
  navigation)
- **AND** the keydown propagates to the input so the browser's
  default text-selection-extension behavior runs

#### Scenario: Shortcut suppressed while the Kill dialog is open

- **GIVEN** the Kill confirmation dialog is open (its `Cancel`
  button has focus, not an input) and the URL is
  `/manage/tmux?session=A`
- **WHEN** the user presses `Ctrl+Shift+ArrowDown`
- **THEN** the URL remains `/manage/tmux?session=A`

#### Scenario: Shortcut suppressed while the Create dialog is open

- **GIVEN** the New-session dialog is open with its `<Input>`
  focused and the URL is `/manage/tmux?session=A`
- **WHEN** the user presses `Ctrl+Shift+ArrowDown`
- **THEN** the URL remains `/manage/tmux?session=A`

#### Scenario: Ctrl-without-Shift does not trigger navigation

- **GIVEN** the URL is `/manage/tmux?session=A` and the visible
  list is `[A, B, C]`
- **WHEN** the user presses `Ctrl+ArrowDown` (no Shift)
- **THEN** the URL remains `/manage/tmux?session=A`
- **AND** the page's keydown handler does NOT call
  `preventDefault()`

#### Scenario: Empty visible list is a no-op

- **GIVEN** the visible list is `[]` (filter `Stale` with no stale
  rows, for example)
- **WHEN** the user presses `Ctrl+Shift+ArrowDown` (or
  `ArrowUp`)
- **THEN** the page makes no `router.replace` call
- **AND** the keydown has `defaultPrevented === false`

#### Scenario: Reduced motion preference disables smooth scroll

- **GIVEN** the user agent reports `prefers-reduced-motion: reduce`
  and the keyboard navigation changes the selection
- **WHEN** the scroll-into-view is invoked
- **THEN** the call SHALL use `behavior: 'auto'` instead of
  `'smooth'`

#### Scenario: Shortcut is removed when leaving the page

- **GIVEN** the user is on `/manage/tmux` and the shortcut is
  active
- **WHEN** the user navigates away (`router.push('/p/foo')`),
  unmounting `TmuxManagePageClient`
- **THEN** the global keydown listener SHALL be removed and
  pressing `Ctrl+Shift+ArrowDown` on the new page SHALL NOT
  trigger any selection change

#### Scenario: Shortcut fires when focus is inside the ttyd iframe

- **GIVEN** the user is on `/manage/tmux?session=A` with the
  visible list `[A, B, C]`, has clicked into the right-pane
  ttyd terminal so xterm's hidden textarea has focus
- **WHEN** the user presses `Ctrl+Shift+ArrowDown`
- **THEN** the iframe-side capture listener SHALL receive the
  event first and call `preventDefault()` + `stopPropagation()`
- **AND** xterm.js SHALL NOT receive the event (no character
  sent to ttyd over WebSocket, no scroll/selection inside the
  terminal)
- **AND** a synthesized `KeyboardEvent` SHALL be dispatched on
  the parent `window` with `ctrlKey: true`, `shiftKey: true`,
  `altKey: false`, `metaKey: false`, and the same `key`/`code`
- **AND** the parent's page-level handler SHALL run and the URL
  SHALL become `/manage/tmux?session=B`

#### Scenario: Non-shortcut keys inside the iframe pass through to xterm

- **GIVEN** the user is on `/manage/tmux?session=A` with focus
  in the right-pane terminal
- **WHEN** the user types a non-shortcut key (e.g. `a`, or
  `ArrowDown` without Ctrl+Shift, or `Ctrl+C`)
- **THEN** the iframe-side forwarder SHALL NOT call
  `preventDefault()`, `stopPropagation()`, or re-dispatch
- **AND** the keystroke SHALL reach xterm.js normally and be
  forwarded to the underlying tmux/agent

#### Scenario: Forwarder is not installed for drawer/popup TerminalView usage

- **GIVEN** a `<TerminalView>` is rendered with `source !==
  'manage'` (e.g. inside the side drawer or popup window) and
  the iframe has loaded
- **WHEN** the user presses `Ctrl+Shift+ArrowDown` with focus
  inside that iframe
- **THEN** the forwarder SHALL NOT be installed
- **AND** xterm.js SHALL receive the event as it would for any
  other key (no parent-side navigation occurs)

#### Scenario: Forwarder is removed when the iframe is replaced

- **GIVEN** a `<TerminalView source="manage">` has an installed
  iframe forwarder for session A
- **WHEN** the parent selection switches to session B and the
  iframe URL changes (React re-mounts the iframe due to
  `key={iframeUrl}`)
- **THEN** the previous forwarder SHALL be removed (its
  `removeEventListener` cleanup runs)
- **AND** a fresh forwarder SHALL be installed on the new
  iframe's `contentDocument` once it loads

#### Scenario: Forwarder does not attach to the initial about:blank document

- **GIVEN** an iframe inside `<TerminalView source="manage">` is
  freshly inserted with a `src` and, at the moment the React
  effect runs, `iframe.contentDocument.URL === 'about:blank'`
  and `readyState === 'complete'` (the browser-provided
  placeholder before the real navigation finishes)
- **WHEN** the effect's eager `tryAttach` invocation runs
- **THEN** it SHALL detect `URL === 'about:blank'` and return
  without attaching a listener to that document
- **AND** the registered `'load'` event handler on the iframe
  SHALL subsequently re-invoke `tryAttach` once the real ttyd
  document is the `contentDocument`, attaching the listener
  there instead

#### Scenario: Re-attach on iframe load swaps out any stale listener

- **GIVEN** a forwarder has been attached to some document A
  inside the iframe
- **WHEN** the iframe fires a fresh `'load'` event (rare, e.g.
  internal navigation) and `tryAttach` sees a different
  `contentDocument` B
- **THEN** the implementation SHALL remove the listener from A
  before adding it to B, so the two attachments do not stack

#### Scenario: Forwarder is a no-op when contentDocument is unreadable

- **GIVEN** a `<TerminalView source="manage">` whose iframe
  loads from a hypothetical cross-origin URL (e.g. a
  reverse-proxy misconfiguration) so
  `iframe.contentDocument` access throws a SecurityError
- **WHEN** the effect attempts to attach the forwarder
- **THEN** the SecurityError SHALL be caught and the forwarder
  SHALL silently no-op
- **AND** the parent-window listener SHALL continue to function
  for keystrokes received with focus outside the iframe
