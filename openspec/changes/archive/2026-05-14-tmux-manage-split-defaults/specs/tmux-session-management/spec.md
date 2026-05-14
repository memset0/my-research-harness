## ADDED Requirements

### Requirement: Split-pane orientation defaults to horizontal before the viewport size is known

The `/manage/tmux` `ResizablePanelGroup` SHALL render with `orientation="horizontal"` (the desktop layout) on both the SSR pass and the first client commit — i.e. before the `useEffect`-driven `window.matchMedia('(min-width: 768px)')` read has resolved.

The intent is to bias the unknown-viewport case toward the common case
(desktop). The existing "Page renders as a resizable split-pane on
desktop" / "Page renders as a vertical split on mobile" requirements
continue to govern the resolved-viewport behavior: once the media query
resolves, the orientation switches to `vertical` on viewports `< 768px`
and stays `horizontal` on viewports `>= 768px`. A mobile user therefore
sees at most one frame of horizontal layout before the orientation
rotates; a desktop user sees zero frames of the wrong orientation.

The page SHALL accomplish this by:
- Passing `defaultValue = true` to the `useMediaQuery('(min-width: 768px)')`
  call so the hook's initial state on both the SSR pass and the first
  client render is `true` (desktop). The hook continues to update
  asynchronously via its effect when the actual media query resolves.
- The `useMediaQuery` helper SHALL accept an optional second parameter
  `defaultValue: boolean` (default `false`, backward-compatible with
  any future caller that wants the previous mobile-biased default).

#### Scenario: Server-rendered HTML uses horizontal orientation
- **GIVEN** the `/manage/tmux` page is rendered on the server (no `window`)
- **WHEN** the SSR pass produces HTML
- **THEN** the `ResizablePanelGroup` root SHALL carry
  `aria-orientation="horizontal"` (or, equivalently, render with the
  horizontal-orientation `flex` direction, NOT the
  `aria-[orientation=vertical]:flex-col` mobile branch)

#### Scenario: First client render before media query resolves uses horizontal orientation
- **GIVEN** the client has just mounted the page and `useEffect`-driven
  `matchMedia` listeners have NOT yet fired
- **WHEN** React commits the first client render
- **THEN** the `ResizablePanelGroup` SHALL be rendered with
  `orientation="horizontal"` regardless of the actual viewport width

#### Scenario: Mobile viewport rotates to vertical after media query resolves
- **GIVEN** the actual viewport width is `< 768px`
- **WHEN** the post-mount media-query effect fires and reports `matches: false`
- **THEN** the `ResizablePanelGroup` SHALL re-render with
  `orientation="vertical"` (the existing mobile behavior)
- **AND** the brief horizontal-orientation flash that preceded this
  re-render is acceptable and SHALL NOT be papered over with a loading
  spinner or hidden visibility

#### Scenario: useMediaQuery defaultValue parameter is backward compatible
- **GIVEN** an existing caller invokes `useMediaQuery('(min-width: 1024px)')`
  with NO second argument
- **WHEN** the hook initializes
- **THEN** the initial value SHALL be `false` (the prior behavior is
  preserved when no `defaultValue` is supplied)

## MODIFIED Requirements

### Requirement: Split-pane sizes persist in localStorage

The `/manage/tmux` page SHALL persist the split-pane sizes across reloads using `localStorage`. The storage key SHALL be `memon:manage-tmux:split-sizes`. The stored value SHALL be a JSON object map keyed by panel id (`tmux-list`, `tmux-terminal`) whose values are numbers in `[0, 100]` summing to `100` (the same `Layout` shape that `react-resizable-panels` accepts as `defaultLayout`).

The page SHALL:

- **On first paint (mount-time):** the `ResizablePanelGroup` SHALL be
  mounted with NO `defaultLayout` prop. The per-panel initial sizes
  SHALL come from each `ResizablePanel`'s `defaultSize` / `maxSize` /
  `minSize` props:
  - On desktop (`orientation="horizontal"`): the LEFT panel SHALL carry
    `defaultSize="300px"` and `maxSize="50%"`. Because `defaultSize` is
    clamped to `maxSize` by the library's constraint solver, the LEFT
    panel's first-paint width SHALL equal `min(300px, 50% × containerWidth)`.
    The RIGHT panel takes the remainder.
  - On mobile (`orientation="vertical"`): the LEFT panel (which is the
    TOP panel in vertical orientation) SHALL carry `defaultSize="50%"`
    with no `maxSize` cap. The default split SHALL be `50 / 50`.
  - The `minSize` constraints SHALL be `"180px"` (desktop) and `25%`
    (mobile), preserving the prior "list pane cannot be dragged
    impractically thin" behavior.

- **Post-mount stored-layout hydration:** in a `useLayoutEffect` that
  runs once after the group has mounted, the page SHALL read the stored
  layout from `localStorage` via the group's imperative ref:
  - If the stored value is present, parses as a JSON object, has BOTH
    `tmux-list` and `tmux-terminal` keys with numeric values in
    `[0, 100]`, AND those values sum to within `0.5` of `100`, the page
    SHALL call `groupRef.setLayout(stored)` to apply the stored sizes.
  - If the stored value is absent, invalid, or fails validation, the
    page SHALL leave the layout at the mount-time defaults.

- **On layout change (`onLayoutChanged`):** the page SHALL debounce by
  `~250ms` and write the layout (in the object-map shape above) to
  `localStorage`. Writes SHALL be wrapped in `try/catch` so private
  mode / quota errors fall back to in-memory state without breaking
  the page.

A single localStorage key is used for both orientations. After rotating
between desktop and mobile orientations, the previously-saved sizes are
applied; the user can drag once and the new sizes get saved. The
`maxSize="50%"` cap on desktop applies during user drag too: the left
pane cannot be dragged past 50% of the container — a session list wider
than half the page is always wrong for this view.

#### Scenario: Pane sizes survive a reload
- **GIVEN** the user drags the divider so the left pane is 40% wide and the right pane is 60%
- **WHEN** the user refreshes the page
- **THEN** the pane sizes after reload are 40 / 60
- **AND** the `localStorage` value at `memon:manage-tmux:split-sizes` is `{"tmux-list":40,"tmux-terminal":60}` (modulo numeric formatting)

#### Scenario: Default desktop split applies on first visit at wide viewport
- **GIVEN** `memon:manage-tmux:split-sizes` is absent from `localStorage` and the container width is 1200px
- **WHEN** the user opens `/manage/tmux` for the first time
- **THEN** the initial LEFT pane width SHALL be `300px` (because `min(300, 0.5 × 1200) = 300`)
- **AND** the initial RIGHT pane width SHALL be `900px` (the remainder)
- **AND** these correspond to roughly `25 / 75` in percentage terms

#### Scenario: Default desktop split applies on first visit at narrow desktop viewport
- **GIVEN** `memon:manage-tmux:split-sizes` is absent and the container width is 500px (a narrow desktop window, still `>= 768px` if the browser window is wider but the available split container is narrower due to the sidebar inset)
- **WHEN** the user opens `/manage/tmux`
- **THEN** the initial LEFT pane width SHALL be `250px` (because `min(300, 0.5 × 500) = 250`)
- **AND** the initial RIGHT pane width SHALL be `250px`
- **AND** these correspond to `50 / 50` in percentage terms

#### Scenario: Default mobile split applies on first visit
- **GIVEN** `memon:manage-tmux:split-sizes` is absent and the viewport is below `md`
- **WHEN** the user opens `/manage/tmux`
- **THEN** the initial split is `50 / 50` (vertical orientation, no `maxSize` cap on mobile)

#### Scenario: Corrupted localStorage value falls back to default
- **GIVEN** `localStorage.memon:manage-tmux:split-sizes` is `"not json"` or is an object missing a panel id key or has non-numeric values
- **WHEN** the page mounts
- **THEN** the `useLayoutEffect` SHALL leave the mount-time defaults in place (NOT call `groupRef.setLayout`)
- **AND** the corrupted value SHALL be overwritten on the next layout change (after the user drags the divider)

#### Scenario: Left pane cannot be dragged past 50% on desktop
- **GIVEN** the desktop split layout is mounted (viewport `>= 768px`)
- **WHEN** the user drags the divider rightward as far as possible
- **THEN** the LEFT panel's width SHALL clamp at `50%` of the container width
- **AND** subsequent reloads with `memon:manage-tmux:split-sizes = {"tmux-list":50,"tmux-terminal":50}` SHALL still apply the `50/50` layout (the `maxSize="50%"` cap is exactly satisfied, not exceeded)
