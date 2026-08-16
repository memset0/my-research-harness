## Context

The root-mounted terminal provider currently owns a single Radix Sheet and keeps terminal target state alive across Next.js route changes. Its fixed `min(80vw, 1280px)` width is embedded in the sheet classes. A new docked surface must reuse that same target state and `TerminalView` without changing the ttyd manager or remounting the dashboard on every drag.

The project and management layouts have their own sidebars, fixed controls, and scrolling behavior. The terminal provider sits above all of them, so it is the only shared place that can split every route consistently.

## Goals / Non-Goals

**Goals:**

- Keep one active terminal target while moving its browser client among drawer, right split, and popup surfaces.
- Keep pointer dragging smooth without re-rendering the ttyd iframe for every pointer event.
- Preserve independent drawer and split widths across reloads.
- Keep existing tmux and Herdr process-lifecycle guarantees unchanged.

**Non-Goals:**

- Supporting more than one docked terminal at a time.
- Resizing or controlling popup windows after they open.
- Changing ttyd, tmux, or Herdr server-side session ownership.
- Providing a horizontal split on mobile-sized viewports.

## Decisions

### Keep target state separate from presentation surface

The provider will retain the existing discriminated target state and add a presentation value (`drawer` or `split`). Existing open methods continue to select the drawer; explicit split open methods select the new surface. Surface-switch buttons update only the presentation value, so they do not create or stop backend processes.

This is preferable to two independent terminal providers because independent providers could start duplicate clients, disagree about the active session, or lose the current target during a mode switch.

### Use a stable root shell with a flex-based right dock

The provider will always render stable wrapper elements around application children. They behave as `display: contents` in normal/drawer mode. In split mode the outer wrapper becomes a viewport-height flex row, the application region becomes the scrollable flexible left side, and the terminal becomes a fixed-width right aside.

Keeping the wrapper hierarchy stable avoids remounting the page tree when the split opens. A manual flex width also works with the existing route-specific sidebars and does not require dynamically reconstructing a resizable-panel group around server-rendered children.

### Resize through a shared accessible divider

Drawer and split surfaces will use the same divider component at the left edge of the terminal. Pointer movement writes the live width directly to the nearest terminal-panel DOM element; pointer release commits the value to React state and localStorage. Arrow keys commit discrete 16-pixel steps, or 64 pixels with Shift.

Direct DOM updates keep the iframe and the rest of the React tree from re-rendering on every pointer event. This follows the established resizable-sidebar interaction model already used in the application.

### Persist independent pixel widths with viewport-aware limits

The drawer and split use separate localStorage keys. The overlay drawer preserves the existing effective default of `min(80vw, 1280px)` and leaves a small viewport gutter. The split has a narrower desktop default and always reserves a minimum usable width for the left application region. Invalid or out-of-range stored values are ignored or clamped when used.

Pixels are used instead of percentages because users generally expect the terminal columns to remain stable while the application area absorbs moderate viewport changes. The limits are recalculated against the current viewport during each interaction.

### Treat narrow viewports as drawer-only

An attempt to open or switch to split below the existing 768-pixel mobile breakpoint will present the same target in the drawer. The split control is hidden there. This avoids two unusably narrow panes and preserves the existing mobile overlay behavior.

## Risks / Trade-offs

- **[Fixed-position descendants inside the application may still size against the viewport]** → The left region clips overflow while split mode is active, and browser tests will cover representative project and management layouts.
- **[Changing surface remounts TerminalView and reconnects its browser client]** → The backend entry is manager-deduplicated, so remounting only reconnects to the same ttyd URL and does not restart tmux or Herdr processes.
- **[Stored widths may become unsuitable after moving between monitors]** → Clamp every loaded or dragged width against the current viewport instead of trusting persisted values.
- **[Pointer cancellation can leave a transient inline width]** → Handle pointer cancel through the same commit path as pointer up and release capture defensively.

## Migration Plan

The new UI reads no previous preference and therefore opens at the historical drawer width on first use. Deployment requires only the normal web build and process restart; no config or data migration is needed. Rollback removes the new client code, and the two unused localStorage keys are harmless.
