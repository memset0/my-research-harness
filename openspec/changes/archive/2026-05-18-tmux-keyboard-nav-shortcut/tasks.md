## 1. Pure neighbor-resolution helper

- [x] 1.1 Add `resolveNeighbor(list, selected, direction)` as an exported
  function in `apps/web/app/manage/tmux/tmux-page.client.tsx` (sibling to
  the existing exported `applySelectionToCache`), returning `string | null`
  per design D2.
- [x] 1.2 Add `apps/web/test/browser/manage-tmux-keyboard-nav.test.ts`
  (the rest of the manage-tmux unit tests already live in
  `test/browser/`; co-located naming kept consistent) with unit tests
  covering: next-with-room, prev-with-room, clamp-bottom, clamp-top,
  no-selection bootstrap, selected-not-in-list re-bootstrap, empty-list
  no-op, single-row clamp / bootstrap, and no-mutation invariant.
  (10 tests, all green.)

## 2. Wire keydown effect inside TmuxManagePageClient

- [x] 2.1 Add a `useEffect` to `TmuxManagePageClient` that attaches a
  single `window.addEventListener('keydown', handler)` and cleans up on
  unmount. The effect's deps are `visible`, `selectedName`,
  `killTarget`, `renameTarget`, `createOpen`, `router`, plus any
  refs needed for scroll. Handler logic per design D1 / D3 / D4 / D5.
- [x] 2.2 In the handler, return early when modifiers don't match
  exactly `Ctrl+Shift` (no Alt, no Meta) or when the key is not
  `ArrowUp` / `ArrowDown`.
- [x] 2.3 In the handler, return early (without `preventDefault`) when
  the target is `input`/`textarea`/`select`/contenteditable, OR when any
  of `killTarget !== null`, `renameTarget !== null`, `createOpen` is
  true.
- [x] 2.4 Call `resolveNeighbor(visible, selectedName, direction)`. If
  `null`, return without `preventDefault`. Otherwise, call
  `event.preventDefault()`, then `writeSelection(next)`, then schedule
  a microtask / RAF to find the card by `[data-session-name="<next>"]`
  and call `scrollIntoView({ block: 'nearest', behavior: prefersReduced
  ? 'auto' : 'smooth' })`.
- [x] 2.5 Add `data-session-name={row.sessionName}` to the `SessionCard`
  root element so the keydown handler can locate it post-render.

## 3. Validate the openspec change

- [x] 3.1 Run `openspec validate tmux-keyboard-nav-shortcut --type change`
  with `--strict` if available; fix any structural issues. (This was
  done as part of propose; this task is a re-check after any in-apply
  edits to the spec / tasks.)

## 4. Production-build verification

- [x] 4.1 Run `pnpm --filter @memon/web typecheck` — must pass.
- [x] 4.2 Run the unit tests for `tmux-page.client.test.tsx` (or
  whatever test file covers `resolveNeighbor`) — must pass.
- [x] 4.3 Per CLAUDE.md "dev: prefer prod build" — kill any running
  3737 server, then `pnpm --filter @memon/web build` and `pnpm start`
  in background. Confirm `/api/tmux-sessions` returns rows under
  `-u $MEMON_USER:$MEMON_PASS`.
- [x] 4.4 Fetch `http://localhost:3737/manage/tmux` and grep the HTML
  for `data-session-name=` to confirm the new attribute is present on
  the cards.
- [x] 4.5 Browser keypress verification: not exercisable from curl;
  the apply phase confirmed the load-bearing markers (`data-session-name`,
  `"ArrowDown"`, `"ArrowUp"`, `scrollIntoView`) all ship in the prod
  chunk for `/manage/tmux`, and `resolveNeighbor` is unit-tested
  end-to-end (10/10 green). User to do the final keypress smoke test
  in their browser; if any binding misfires (e.g. an exotic editable
  control on this page steals focus), file a follow-up.

## 5. Iframe-focus forwarding (post-ship fix)

- [x] 5.1 Extract both `isManageTmuxNavShortcut(event: KeyboardEvent):
  boolean` and `resolveNeighbor(...)` into a dedicated module
  `apps/web/app/manage/tmux/keyboard-nav.ts`. `tmux-page.client.tsx`
  imports + re-exports them (so existing test imports keep working)
  and `TerminalView` imports the matcher directly — this avoids a
  circular import between the page client and the component.
  Refactored the parent keydown handler to call `isManageTmuxNavShortcut`
  so the modifier contract lives in exactly one place.
- [x] 5.2 Extend the unit test file with cases for
  `isManageTmuxNavShortcut`: matches Ctrl+Shift+ArrowDown,
  matches Ctrl+Shift+ArrowUp, rejects Ctrl-only, rejects Shift-only,
  rejects Ctrl+Shift+Alt+Arrow, rejects Ctrl+Shift+Meta+Arrow,
  rejects unrelated keys.
- [x] 5.3 In `apps/web/components/terminal-view.tsx`, add a `ref` on
  the iframe and a `useEffect` that runs while `phase === 'ready'`
  AND `source === 'manage'`. The effect attaches a `'keydown'`
  listener with `{ capture: true }` on `iframe.contentDocument`,
  wrapped in `try/catch` for the same-origin assumption.
- [x] 5.4 Inside the iframe listener: if `isManageTmuxNavShortcut`
  matches, call `event.preventDefault()` and
  `event.stopPropagation()`, then `window.dispatchEvent(new
  KeyboardEvent('keydown', { key, code, ctrlKey: true, shiftKey:
  true, altKey: false, metaKey: false, bubbles: true, cancelable:
  true }))` on the parent window captured by closure. Otherwise,
  return without side effects.
- [x] 5.5 Cleanup: on effect teardown (iframe URL change, source
  change, or unmount), remove the listener using the same options
  object passed to `addEventListener`.
- [x] 5.6 Rebuilt prod from clean `.next/`, smoke-tested
  `/manage/tmux` + `/api/tmux-sessions` (200), confirmed
  prod bundle `page-deee08c218796475.js` contains the load-
  bearing markers: `contentDocument` (×3), `dispatchEvent`
  (×1), `stopPropagation` (×6), `data-session-name` (×2),
  `"ArrowDown"` / `"ArrowUp"` (matcher logic), `scrollIntoView`.
