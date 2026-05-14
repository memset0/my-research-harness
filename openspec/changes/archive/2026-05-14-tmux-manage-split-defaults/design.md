## Context

The `/manage/tmux` page is a two-pane split layout (left list, right
terminal) built on `react-resizable-panels@^4.11.1`. The current
implementation has two first-paint quirks that show up only when the
user has no stored layout in `localStorage`:

1. **Orientation flash**: `useMediaQuery('(min-width: 768px)')` returns
   `false` until its `useEffect` fires (the hook's `useState` initial
   value is `false`). On a desktop browser, the SSR pass and the first
   client render therefore use the **mobile vertical** orientation;
   the orientation flips to horizontal one tick later. The common case
   (desktop) shows the wrong layout for one frame.

2. **Hardcoded 33% / 67% default**: the desktop default is a
   percentage map (`{ list: 33, terminal: 67 }`) passed to
   `useLocalStorageState`. On a 1920px-wide viewport, this hands ~633px
   to the list (way wider than the cards need; ~300px is the
   comfortable width) and cramps the terminal at ~1287px. The default
   does not adapt to viewport width.

The user has explicitly asked for both to change:
- Default orientation should bias toward desktop in the unknown-viewport state.
- Default left width should be `min(50% × pageWidth, 300px)`.

Both rules only apply on first paint (no localStorage entry). The
persisted layout is unchanged for users who have already dragged the
divider.

## Goals / Non-Goals

**Goals:**

- Eliminate the desktop-orientation flicker by making horizontal the
  initial assumption for both SSR and the first client render.
- Replace the hardcoded 33/67 desktop default with a pixel-anchored
  rule that scales gracefully: `min(50%, 300px)` on the left, remainder
  on the right.
- Keep the localStorage persistence wire format compatible (the same
  `{ "tmux-list": number, "tmux-terminal": number }` map shape used
  today). Existing users with a stored layout SHALL see their stored
  layout, unchanged.
- Avoid introducing a hydration-mismatch warning on the
  `ResizablePanelGroup`. Both SSR and the first client render produce
  identical markup; post-mount stored-layout hydration happens
  imperatively via the group ref.

**Non-Goals:**

- No change to mobile (vertical orientation) defaults — the existing
  50/50 split is fine for a vertical stack and the user didn't ask for
  a change there.
- No change to the `react-resizable-panels` version, the localStorage
  key, or the wire format of the stored value.
- No design change to the cards, badges, footer, header, dialogs, or
  any other element of the page beyond the panel-group sizing /
  orientation initialization.
- No new dependency. We use the existing library's `defaultSize` /
  `maxSize` / `minSize` props (which already accept pixel strings) and
  the existing `GroupImperativeHandle.setLayout()` API.

## Decisions

### D1. Use the library's per-Panel `defaultSize="300px"` + `maxSize="50%"` instead of computing the default with `window.innerWidth`

**Decision:** Express the `min(50%, 300px)` rule via the library's
existing constraint solver:
- Left panel desktop props: `defaultSize="300px"`, `maxSize="50%"`,
  `minSize="180px"`.
- Right panel desktop props: `minSize="35%"` (preserve current).
- Left panel mobile props: `defaultSize="50%"`, `minSize={25}`.

The library clamps `defaultSize` to `[minSize, maxSize]` on mount, so
the left panel's first-paint width equals
`clamp(180px, 300px, 50% × containerWidth)` = `min(300px, 50% × containerWidth)`
when the container is `>= 360px` wide (always true in practice).

**Alternatives considered:**

- **Read `window.innerWidth` in a `useState` lazy initializer, compute
  the px width, pass it as `defaultSize`.** Rejected: re-derives the
  library's constraint logic, adds an SSR/client mismatch (server
  doesn't know `innerWidth`), and ignores the container's actual width
  (the panel group lives inside `SidebarInset`, which is narrower than
  `innerWidth`).

- **Use a `ResizeObserver` to measure the container and call
  `groupRef.setLayout` after mount.** Rejected: causes a visible reflow
  (default layout → measured layout) on every mount, more code, no
  benefit over the constraint-solver approach.

- **Hand-compute a CSS `min(50%, 300px)` and inject it as inline
  style.** Rejected: the library owns the panel widths via flex-grow
  and JS measurement; CSS overrides would fight the library.

### D2. Use `useMediaQuery('(min-width: 768px)', /* defaultValue */ true)` to fix the orientation flash

**Decision:** Extend `useMediaQuery` with an optional second parameter
`defaultValue: boolean` (default `false`, backward-compatible). The
tmux page passes `true`, so both the SSR pass and the first client
render assume desktop. The hook's existing `useEffect` continues to
update the value asynchronously when the actual media query resolves;
on mobile, that flip happens one tick after first paint and produces a
single frame of horizontal layout before the rotation.

The single-frame mobile flash is **acceptable per the user's explicit
request**: "首先不确认是网页端还是手机端的时候，默认应该是电脑端的左右分屏"
("when uncertain whether it's web or mobile, the default should be
desktop's left-right split").

**Alternatives considered:**

- **Use `useSyncExternalStore` to read `window.matchMedia` synchronously
  on the client.** This would eliminate the mobile flash entirely
  (client first render uses the actual media query). Rejected:
  introduces an SSR-vs-client hydration mismatch (SSR has no
  `matchMedia`), requiring `suppressHydrationWarning` plumbing. The
  flash is one frame and only on mobile, which is the minority case
  for this page. Not worth the complexity.

- **Render a skeleton until the media query resolves, then mount the
  Group.** Rejected: replaces a one-frame flash with a multi-frame
  loading state, strictly worse.

- **Change `useMediaQuery`'s hardcoded initial value from `false` to
  `true` (no new parameter).** Rejected: the hook is generic and could
  be used by other components in the future that want the
  mobile-biased default. Adding an optional parameter preserves both
  options.

### D3. Imperative `groupRef.setLayout(stored)` for localStorage hydration, no `defaultLayout` prop

**Decision:** Remove the `useLocalStorageState`-driven `defaultLayout`
prop from `ResizablePanelGroup`. Instead:

- Mount the Group with NO `defaultLayout`. The per-panel `defaultSize`
  / `maxSize` / `minSize` express the default rule (D1).
- In a `useLayoutEffect` that runs once after mount, read
  `localStorage[SPLIT_STORAGE_KEY]`. If valid, call
  `groupRef.current?.setLayout(parsedLayout)` to apply the stored
  sizes synchronously.
- On `onLayoutChanged`, debounce by 250ms and write the new layout to
  localStorage.

This shape produces identical SSR and first-client-render markup (both
use the default mount-time layout), so there is no hydration mismatch
warning. Users with a stored layout see one tick of the default before
the layout effect applies their stored sizes — a tiny flicker that
`useLayoutEffect` (vs `useEffect`) minimizes because it runs before
the browser paints.

**Alternatives considered:**

- **Keep `useLocalStorageState` and pass its value as `defaultLayout`.**
  Rejected: `defaultLayout` is a mount-time-only prop on
  `ResizablePanelGroup` v4. If the stored value hydrates after mount
  (which it always does via `useLocalStorageState`'s
  `useEffect`-driven hydration), the layout doesn't update. The
  current implementation has a latent bug here that the imperative
  approach fixes.

- **Lazy-initialize state from `localStorage` synchronously in a
  `useState(() => ...)` initializer.** Rejected: SSR returns `null`,
  client first render returns the stored value → hydration mismatch
  on the Group's mount-time `defaultLayout` prop.

### D4. The `maxSize="50%"` cap is permanent, not just a mount-time clamp

**Decision:** Keep `maxSize="50%"` on the left panel on desktop even
after the user has interacted with the divider. This means the user
cannot drag the left pane past 50% of the container.

**Rationale:** A session-list pane wider than half the page is always
wrong for this view — the cards are compact, the terminal is the main
event. Letting the user drag past 50% accidentally would feel like a
bug in their next session. The 50% cap is a guardrail, not an arbitrary
default.

**Trade-off:** Users with an existing localStorage entry recording a
left-pane width `> 50%` (possible because the previous implementation
had no max cap) will have their layout snapped back to 50% on first
visit after this change ships. The `groupRef.setLayout(stored)` call
inside `useLayoutEffect` will be clamped by the library's constraint
solver. This is an acceptable one-time inconvenience for the small
number of users (if any) in that state.

### D5. Test stays at unit/RTL level, no Playwright

**Decision:** Add a vitest + RTL browser-style test at
`apps/web/test/browser/manage-tmux-split-defaults.test.tsx`. The test
will mock `window.matchMedia`, mount the page, assert the orientation
prop on the Group, assert the left panel's `defaultSize` and `maxSize`
attributes, simulate a stored-layout hydration via localStorage, and
assert `groupRef.setLayout` is called.

**Rationale:** This is a JS-only render-time concern; no actual pointer
drag or layout measurement is exercised by the change. A full
Playwright pass would be over-engineering. Existing browser-style
tests in `apps/web/test/browser/` (e.g.
`run-panel-persist.test.tsx`) follow the same pattern.

## Risks / Trade-offs

- **[Risk] Library behavior under unit-suffixed `defaultSize` may not
  perfectly match the spec's `min(50%, 300px)` formula.** →
  Mitigation: the implementation step includes a manual browser-side
  verification at three viewport widths (1200px, 500px, 360px) to
  confirm the library clamps as expected. If the library doesn't
  honor `maxSize` at mount, fall back to D2's
  `useState(() => Math.min(...))` lazy initializer (with the
  attendant SSR/hydration complexity).

- **[Risk] Existing users may have a stored layout with a left-pane
  width `> 50%`.** → Mitigation: D4 documents this is intentional;
  the cap clamps stored layouts on first visit after the change. A
  changelog or release note would soften surprise, but for this
  single-user-per-host tool, the user will just notice the divider
  position shifted and re-drag.

- **[Risk] `useLayoutEffect` is server-unsafe; calling it in a
  `'use client'` component during SSR throws a warning.** → Mitigation:
  the tmux-page client component is `'use client'`-tagged, and React
  treats `useLayoutEffect` calls in client components as `useEffect`
  on the server (no-op). No additional handling is needed.

- **[Trade-off] One frame of horizontal layout on mobile before the
  rotation to vertical.** → Accepted per user's explicit request. The
  mobile flash is bounded (one frame, ~16ms at 60fps) and the
  alternative (mobile flash → desktop default) is the status quo we're
  fixing.

## Open Questions

None — the user's intent is precise and the library API supports the
implementation directly.
