## Why

ttyd already copies native xterm selections automatically, but that behavior is easy to misread when tmux or Herdr enables mouse reporting because ordinary drag is then TUI input rather than text selection. Users need the native selection convention and explicit copy shortcut to work consistently without adding another interaction mode.

## What Changes

- Grant the same-origin ttyd iframe explicit clipboard read/write permission.
- Handle the conventional terminal copy shortcut (`Ctrl+Shift+C`) and macOS `Cmd+C` before xterm sends the key to the terminal process.
- Preserve ttyd/xterm's native auto-copy-on-selection behavior: ordinary drag in shell output and `Shift+drag` when a TUI has enabled mouse reporting both select and copy.
- Do not add a separate Copy mode or intercept terminal mouse input.
- Apply the behavior uniformly to drawer, right split, popup, management-page, tmux, and Herdr terminal views.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `browser-terminal`: add reliable selection and clipboard behavior to the shared ttyd client surface.

## Impact

- Affects only the shared browser `TerminalView` clipboard bridge and its focused tests.
- Does not change ttyd process arguments, tmux sessions, Herdr workspaces, native mouse selection, or backend lifecycle behavior.
