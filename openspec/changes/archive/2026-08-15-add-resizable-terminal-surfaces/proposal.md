## Why

The browser terminal drawer currently uses a fixed width, which wastes space on large displays and can crowd the page on smaller desktop windows. Users also need a persistent right-side terminal that shares the viewport with the dashboard instead of covering it or leaving the application in a popup.

## What Changes

- Make the desktop terminal drawer width adjustable with a draggable, keyboard-accessible divider and persist the chosen width locally.
- Add a right-side split surface that keeps the dashboard visible on the left and the ttyd terminal visible on the right.
- Make the split divider draggable and persist its width independently from the overlay drawer width.
- Add an `Open in split view` action to Open With and controls for moving an active terminal between drawer, split, and popup surfaces.
- Keep Herdr's Open With presentation visually consistent with the peer agent choices instead of adding a backend-specific menu icon.
- Apply the same surfaces to tmux-backed terminals and Herdr without changing either backend's process-lifecycle behavior.
- Fall back to the drawer on narrow/mobile viewports where a horizontal split would not be usable.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `browser-terminal`: define resizable drawer behavior, the docked right split surface, width persistence, and surface switching.
- `experiment-edit`: expose the new split surface from the shared Open With picker.
- `herdr-integration`: allow the Herdr ttyd client to use the same drawer, split, and popup surfaces.

## Impact

- Affects the root-mounted terminal provider, terminal panel chrome, Open With UI, and related component tests.
- Adds browser-local display preferences only; no terminal API, ttyd proxy, tmux session, or Herdr workspace protocol changes are required.
- The split layout temporarily constrains the application to the viewport and gives the left application region its own scrolling area while the terminal is docked.
