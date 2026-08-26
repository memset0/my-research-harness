## Context

The shared `TerminalView` embeds ttyd as a same-origin iframe. ttyd 1.7.7 uses xterm.js and calls `document.execCommand('copy')` when its selection changes, so a completed native selection is automatically copied. The iframe currently declares no clipboard Permissions Policy. xterm gives ordinary dragging to the terminal application while mouse reporting is enabled; `Shift+drag` is its native forced-selection-and-copy escape hatch for both tmux TUIs and Herdr.

`TerminalView` already installs capture-phase listeners inside the same-origin iframe for management-page keyboard navigation, so it has an established lifecycle for attaching after the real ttyd document replaces the initial `about:blank` document.

## Goals / Non-Goals

**Goals:**

- Make terminal copying reliable across every `TerminalView` mode and presentation.
- Preserve `Ctrl+C` as terminal interrupt while supporting conventional terminal copy shortcuts.
- Preserve xterm's native `Shift+drag` selection escape hatch for mouse-reporting TUIs.
- Keep the integration resilient to iframe reloads.

**Non-Goals:**

- Replacing or rebuilding ttyd's embedded xterm client.
- Reading the terminal scrollback through a new server API.
- Changing paste behavior or tmux copy-mode key bindings.

## Decisions

### Extend the existing same-origin iframe bridge

The copy shortcut will be attached to the loaded ttyd document alongside the existing management navigation bridge. The listener is installed for every source rather than only `manage`, and retains the current load/reload cleanup behavior.

This is preferable to patching the downloaded ttyd binary or maintaining a custom ttyd index file, both of which would couple memon to ttyd's private frontend bundle.

### Keep Ctrl+C untouched

Only `Ctrl+Shift+C`, or `Cmd+C` on macOS-style input, is intercepted. Plain `Ctrl+C` continues through xterm to tmux or Herdr as ETX/SIGINT.

### Use xterm's native selection and copy event

The integration SHALL NOT add a separate Copy mode or synthesize mouse events. Ordinary dragging continues to select through xterm in shell output, after which ttyd auto-copies the selection. When a TUI enables mouse reporting, users use xterm's standard `Shift+drag` gesture to force local selection; ttyd then auto-copies that selection while ordinary dragging remains available to the TUI.

No extra shortcut is required after a drag selection because ttyd already auto-copies it. For users who want to copy the current selection again, `Ctrl+Shift+C` or `Cmd+C` asks ttyd's document to execute its copy command. ttyd's existing xterm `copy` handler supplies the selected text, so memon does not depend on xterm private objects or a custom ttyd index.

### Declare clipboard permission on the iframe

The iframe will include `allow="clipboard-read; clipboard-write"`. This makes the intended capability explicit to modern browsers and complements ttyd's existing copy event path.

## Risks / Trade-offs

- **[Browser blocks legacy execCommand despite a user gesture]** → Keep the standard browser copy event path and explicit Permissions Policy; the shortcut executes inside the user's keyboard event.
- **[Users do not know the mouse-reporting convention]** → Document `Shift+drag` as the native xterm selection gesture; do not change or hide the TUI's normal mouse behavior.
