// Pure helpers backing the `/manage/tmux` `Ctrl+Shift+Arrow` shortcut.
//
// Lives in its own module so both the page client
// (`tmux-page.client.tsx`) and the embedded `TerminalView` (which
// installs the same predicate inside its ttyd `iframe.contentDocument`
// so navigation fires when focus is captured by xterm.js) can share the
// modifier contract without creating a circular import between the
// page-client and the component.

/**
 * Modifier+key matcher for the `/manage/tmux` shortcut.
 *
 * Predicate: `Ctrl+Shift+ArrowUp/Down` with `Alt` and `Meta` both NOT
 * pressed. We keep the modifier contract in exactly one place so the
 * iframe forwarder and the parent handler can never drift.
 */
export function isManageTmuxNavShortcut(event: KeyboardEvent): boolean {
  return (
    event.ctrlKey &&
    event.shiftKey &&
    !event.altKey &&
    !event.metaKey &&
    (event.key === 'ArrowDown' || event.key === 'ArrowUp')
  )
}

/**
 * Pure neighbor resolver for the `Ctrl+Shift+Arrow` shortcut.
 *
 * Returns the sessionName the selection should move to, or `null` if the
 * keypress is a no-op (empty list, or clamped at top/bottom). The handler
 * uses the `null` return to decide whether to call `preventDefault()` —
 * a no-op leaves the keydown alone so default browser behavior plays out.
 *
 * Bootstrap rule: when nothing is selected OR the current selection is no
 * longer in the visible list (e.g. filter tab change hid it), both
 * directions resolve to the first row. This is intentional — the user
 * doesn't need to remember which key kicks off navigation.
 */
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
    if (idx >= list.length - 1) return null
    return list[idx + 1]!.sessionName
  }
  if (idx <= 0) return null
  return list[idx - 1]!.sessionName
}
