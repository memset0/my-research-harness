## Why

Activating a wiki outline entry uses native fragment navigation, which scrolls every scrollable ancestor of the target heading. Besides the reading surface it drags the app-level content scroller (32px bottom padding) and the `overflow-hidden` sidebar inset (57px) — neither of which the user can scroll back with the wheel, so the toolbar stays clipped until reload. Reproduced on `W0001` at 1440x1000: after clicking the last outline entry the inset held `scrollTop=57` and the outer scroller `scrollTop=32` even after the reading surface was scrolled back to 0.

## What Changes

- Outline entries and in-body fragment links on wiki surfaces scroll only the reading surface that owns the target heading; ancestor containers keep their scroll position.
- The URL fragment is still updated so the location remains shareable, without triggering a second native scroll.
- Opening a wiki page URL that already carries a heading fragment positions the heading inside the reading surface the same way.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `wiki-viewer`: the generated table of contents requirement gains scroll-containment behaviour for outline activation and fragment deep links.

## Impact

- `apps/web/components/wiki-shell.tsx` (outline list, selected pane), the shared Markdown fragment link path used by the in-body table of contents, and a small shared scroll helper.
- No API, storage, CLI, or skill changes.
