## Why

The `/manage/tmux` split-pane page has two first-paint UX issues that show
up before the user has interacted with the divider:

1. **Orientation flickers from vertical → horizontal on desktop**: the
   `useMediaQuery('(min-width: 768px)')` hook starts at `false` (its
   `useState` initial value), so the very first render — both during SSR
   and on the client before `useEffect` fires — uses the **mobile**
   `vertical` orientation. On the common case (desktop browser), the
   user briefly sees the list stacked above the terminal pane until the
   media query resolves and the layout flips to horizontal. The "uncertain
   at first paint" state should bias to desktop, not mobile.
2. **Default left pane is 33% of the page**, which on wide monitors is
   *much* wider than the session list actually needs (the cards are
   compact; ~300px is the comfortable width to read a couple of badges).
   On a 1920px viewport this hands ~633px to the left pane and leaves
   the terminal cramped at ~1287px. The user wants a sensible
   pixel-anchored default that doesn't bloat on wide screens but also
   doesn't go below 50% on narrow ones.

Both issues only affect the **first-visit / no-localStorage** state.
After the user drags the divider once, the persisted layout is used and
neither default matters.

## What Changes

### Desktop-by-default orientation on first paint

- `useMediaQuery` gains an optional `defaultValue: boolean` parameter
  (default `false`, backward-compatible). The tmux page passes `true` so
  the desktop case is treated as the assumption when the viewport is
  unknown.
- The tmux page renders with `orientation="horizontal"` on the initial
  SSR + client render. Only after the post-mount `useEffect` confirms
  the viewport is below `md` does it flip to `vertical`. Mobile users
  see one frame of horizontal layout before it rotates — explicitly
  accepted per the user's request (the rare mobile case loses one
  frame; the common desktop case loses zero).

### `min(50% × pageWidth, 300px)` first-visit default for the left pane

- **BREAKING (spec only, UI default change — no API/wire format change)**:
  the desktop default split changes from a hardcoded `{ list: 33,
  terminal: 67 }` percentage map to a pixel-anchored rule: the left
  pane's initial width is `min(50% × containerWidth, 300px)`, and the
  right pane takes the remainder. Mobile (vertical orientation) is
  unchanged at `1:1` / `50 / 50`.
- The constraint is expressed via the existing `react-resizable-panels`
  props rather than hand-computing widths: the left `Panel` gets
  `defaultSize="300px"` and `maxSize="50%"` on desktop. The library
  clamps `defaultSize` to `maxSize`, which produces exactly
  `min(300px, 50% × containerWidth)` on first render — no
  `window.innerWidth` math, no SSR mismatch, no layout-thrash effect.
- The `maxSize="50%"` cap **only** governs the initial render — after
  the user drags, the new size persists in localStorage and re-applies
  via the existing `defaultLayout` / imperative-`setLayout` path,
  unconstrained by the cap. The cap is a property of the panel
  constraint solver and applies *during* drag too: the left pane on
  desktop cannot be dragged past 50% of the container. This is
  acceptable behavior — a session list wider than half the page is
  always wrong for this view.

### localStorage hydration without first-paint mismatch

- The current code uses `useLocalStorageState`, which returns the
  `initial` value during SSR + the first client render, then hydrates
  from localStorage in a `useEffect`. Combined with `defaultLayout`
  being a mount-time-only prop on `ResizablePanelGroup`, this means a
  user with a stored layout of e.g. `{ list: 40, terminal: 60 }` still
  sees the **default** layout on first paint, then a flicker to their
  saved layout.
- The new flow mounts the group with NO `defaultLayout` (the per-panel
  `defaultSize` + `maxSize` express the default) and uses
  `useLayoutEffect` + a `groupRef` to read localStorage and call
  `groupRef.setLayout(stored)` synchronously after first paint. This
  eliminates the flicker without introducing a hydration mismatch
  warning (initial SSR + client render produce identical markup; the
  layout is applied imperatively after).

### Capabilities

#### New Capabilities
<!-- none -->

#### Modified Capabilities
- `tmux-session-management`: the "Split-pane sizes persist in
  localStorage" requirement updates its "default split" rule to use the
  `min(50% × containerWidth, 300px)` formula on desktop. A new
  scenario covers the desktop-by-default orientation when the viewport
  is unknown. Page-layout requirement gets one new sentence covering
  the orientation default.

## Impact

### Dependencies
- No new deps. `react-resizable-panels@^4.11.1` already supports
  unit-suffixed `defaultSize`/`maxSize` strings (`"300px"`, `"50%"`)
  and exposes `GroupImperativeHandle.setLayout()`.

### Files (web)
- `apps/web/lib/use-media-query.ts` — add optional `defaultValue` arg.
- `apps/web/app/manage/tmux/tmux-page.client.tsx` — pass
  `defaultValue=true` to `useMediaQuery`; remove
  `DESKTOP_DEFAULT_SIZES` / `MOBILE_DEFAULT_SIZES` percentage maps;
  switch left `ResizablePanel` to `defaultSize="300px" maxSize="50%"`
  on desktop and `defaultSize="50%"` on mobile; replace the
  `useLocalStorageState`-driven `defaultLayout` with a `groupRef`
  + `useLayoutEffect` that reads localStorage and calls `setLayout`.
- `apps/web/test/browser/manage-tmux-split-defaults.test.tsx` (NEW) —
  vitest + RTL test that mounts the page with an empty localStorage
  and asserts the initial layout matches the formula, then exercises
  the persistence path.

### Specs
- `openspec/specs/tmux-session-management/spec.md` — modified
  requirement: "Split-pane sizes persist in localStorage" (default
  rule reworded); modified requirement: page layout (one new
  orientation-default sentence). Two new scenarios.
