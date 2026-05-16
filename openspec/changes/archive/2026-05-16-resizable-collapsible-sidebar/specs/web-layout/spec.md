## ADDED Requirements

### Requirement: Desktop-visible sidebar collapse toggle

The dashboard SHALL render a visible `<SidebarTrigger>` (or
equivalent affordance that calls the same `toggleSidebar()` from the
shadcn `SidebarContext`) on viewports at or above the Tailwind `md`
breakpoint (`>= 768px`). The trigger SHALL remain visible on smaller
viewports too (i.e. removing the previous `md:hidden` constraint, not
adding a separate desktop-only widget). The keyboard shortcut
`Cmd/Ctrl+B` (bound at the `SidebarProvider` level by the shadcn
primitive) SHALL continue to toggle the same state.

The trigger SHALL render in the existing AppBar location (top-left,
to the left of the tab list). The icon, `aria-label` ("Toggle
Sidebar"), and click behavior SHALL come from the unmodified shadcn
`<SidebarTrigger>` component — no fork of `apps/web/components/ui/
sidebar.tsx`.

The trigger MUST remain reachable in BOTH the open and the
collapsed (`offcanvas`) states. Because the `offcanvas` collapsible
mode slides the sidebar entirely off-screen, the trigger MUST NOT
be a child of the `<Sidebar>` element — placing it in the
`<AppBar>` (which lives in the inset) is the canonical placement
and is what this requirement codifies.

#### Scenario: Trigger is visible on desktop

- **GIVEN** the viewport width is `>= 768px`
- **WHEN** the dashboard renders any `/p/<project>/*` or
  `/manage/*` page
- **THEN** the AppBar contains a `<SidebarTrigger>` element with no
  `md:hidden` class
- **AND** clicking the trigger toggles the sidebar's `open` state
  (visible ↔ off-canvas)

#### Scenario: Trigger is visible on mobile (unchanged)

- **GIVEN** the viewport width is `< 768px`
- **WHEN** the dashboard renders
- **THEN** the same `<SidebarTrigger>` element is visible in the
  AppBar
- **AND** clicking it toggles the mobile `Sheet` overlay (the
  shadcn-provided mobile drawer)

#### Scenario: Trigger is reachable when the sidebar is collapsed

- **GIVEN** the user has clicked the trigger so the sidebar is
  off-canvas (the column has slid off the left edge)
- **WHEN** the trigger is re-clicked
- **THEN** the sidebar slides back into view at the user's
  persisted width
- **AND** no part of the trigger was occluded by the sidebar at any
  point during the collapsed state (the trigger lives in the inset,
  not in the sidebar)

#### Scenario: Cmd/Ctrl+B keyboard shortcut continues to work

- **GIVEN** the viewport is `>= 768px` and the trigger has just
  been made visible
- **WHEN** the user presses `Cmd+B` (macOS) or `Ctrl+B` (Linux /
  Windows)
- **THEN** the sidebar toggles open ↔ off-canvas, identically to a
  click on the trigger

### Requirement: Sidebar collapse state persists across reloads

The dashboard SHALL persist the sidebar's open/closed state to the
cookie named `sidebar_state` (the shadcn `Sidebar` primitive's
canonical persistence key, exposed as `SIDEBAR_COOKIE_NAME` in
`apps/web/components/ui/sidebar.tsx`). The cookie SHALL carry the
literal string `"true"` when the sidebar is open and `"false"`
when collapsed, with `path=/` and `max-age=604800` (7 days), exactly
as the shadcn primitive writes it.

Persistence SHALL be applied on the next page load: the server-side
read of `sidebar_state` SHALL drive the `defaultOpen` prop on
`<SidebarProvider>` so the initial SSR HTML renders in the user's
preferred state without a hydration flicker. (This requirement
documents existing shadcn behavior so future changes cannot silently
drop it.)

#### Scenario: Cookie is written on toggle

- **GIVEN** the sidebar is currently open
- **WHEN** the user clicks the `<SidebarTrigger>` to collapse it
- **THEN** the browser's `Cookie` header for `*://<host>/` SHALL
  include `sidebar_state=false; path=/; max-age=<≤604800>`
- **AND** the URL is unchanged

#### Scenario: State survives a reload

- **GIVEN** the user has collapsed the sidebar (cookie is now
  `sidebar_state=false`)
- **WHEN** the user reloads the page
- **THEN** the SSR HTML renders with the sidebar in the collapsed
  state (no first-frame flash of an open sidebar followed by a
  collapse)
- **AND** the client hydrates against the same state

#### Scenario: Cookie is shared across `/p/*` and `/manage/*`

- **GIVEN** the user collapses the sidebar while on `/p/project-a`
- **WHEN** the user navigates to `/manage/tmux`
- **THEN** the sidebar on `/manage/tmux` is also collapsed (the
  cookie is read by the manage-layout's `SidebarProvider` too)

### Requirement: Sidebar drag-to-resize handle on desktop

The dashboard SHALL render a drag handle on the right edge of the
sidebar that allows the user to resize the sidebar's width by
mouse, touch, pen, or keyboard. The handle SHALL be visible only
when ALL of the following conditions hold:

1. The viewport width is `>= 768px` (the Tailwind `md`
   breakpoint).
2. The sidebar is currently in the `open` state (the column is
   visible, not in `offcanvas`).
3. The page mounts the `AppSidebar` (i.e. any `/p/*` or
   `/manage/*` page).

The handle SHALL be implemented as a SEPARATE overlay component
(e.g. `apps/web/components/sidebar-resize-handle.tsx`) and MUST
NOT modify `apps/web/components/ui/sidebar.tsx`. The handle SHALL
absolute-position itself against the sidebar column's right edge
in the same stacking context as the sidebar's fixed-position
wrapper.

The handle SHALL render as a thin (~`4px`-wide) vertical strip
with:

- `cursor: col-resize` at rest,
- a subtle rest-state background (e.g. transparent or a thin
  border tinted with `--sidebar-border`),
- a more prominent hover / active background (e.g. tinted with
  `--primary` at low opacity),
- `role="separator"`, `aria-orientation="vertical"`, and
  `aria-label="Resize sidebar"` for accessibility,
- `tabIndex={0}` so it can receive keyboard focus.

While the user drags the handle (`pointerdown` → `pointermove` →
`pointerup`), the dashboard SHALL update the `--sidebar-width` CSS
variable on the same wrapper element where `SidebarProvider`
emits it (the `data-slot="sidebar-wrapper"` div), so the
`w-(--sidebar-width)` Tailwind classes on the sidebar column and
its fixed sibling track the change in real time. The width SHALL
be clamped to the inclusive range `[192px, 384px]` (corresponding
to `12rem` … `24rem` at a 16px root font size); values outside
this range SHALL be silently clamped to the nearest bound during
the drag.

The drag interaction SHALL use pointer-capture
(`setPointerCapture` on `pointerdown`, released on `pointerup`)
so the drag does not break when the cursor briefly leaves the
handle.

The handle SHALL also respond to keyboard input when focused:

- `ArrowRight` increases the width by `16px`; `ArrowLeft`
  decreases it by `16px`.
- `Shift+ArrowRight` / `Shift+ArrowLeft` adjust by `64px`.
- Keyboard adjustments SHALL clamp to the same `[192px, 384px]`
  range and SHALL persist on each keystroke (no
  pointerup-equivalent debouncing required).

#### Scenario: Handle is visible on desktop when sidebar is open

- **GIVEN** the viewport is `>= 768px` AND the sidebar is open
- **WHEN** the page renders
- **THEN** the DOM contains a focusable element at the sidebar's
  right edge with `role="separator"` and
  `aria-orientation="vertical"`
- **AND** the element's computed `cursor` is `col-resize`

#### Scenario: Handle is hidden on mobile

- **GIVEN** the viewport is `< 768px`
- **WHEN** the page renders
- **THEN** the resize handle element is NOT in the DOM (or is
  visually hidden via a class that includes `hidden md:flex` /
  equivalent)
- **AND** the sidebar renders as the shadcn `Sheet` overlay (the
  existing mobile behavior is unchanged)

#### Scenario: Handle is hidden when the sidebar is collapsed

- **GIVEN** the viewport is `>= 768px` AND the user has clicked
  the trigger so the sidebar is in the `offcanvas` (collapsed)
  state
- **WHEN** the page is in this state
- **THEN** the resize handle is NOT visible / focusable (there is
  no visible column to resize)

#### Scenario: Drag increases the sidebar width

- **GIVEN** the viewport is `>= 768px`, the sidebar is open at
  `256px` (the default `16rem`), and the resize handle is
  focused
- **WHEN** the user `pointerdown`s on the handle, drags `+64px`
  to the right, and `pointerup`s
- **THEN** during the drag the inline style on the
  `data-slot="sidebar-wrapper"` element updates
  `--sidebar-width` continuously from `256px` toward `320px`
- **AND** on `pointerup` the final `--sidebar-width` is `320px`
- **AND** the sidebar column's rendered width is `320px`

#### Scenario: Drag is clamped at the maximum width

- **GIVEN** the sidebar is open at the default `256px`
- **WHEN** the user drags the handle `+200px` to the right
  (would otherwise reach `456px`)
- **THEN** the final `--sidebar-width` is clamped to `384px` (the
  `24rem` upper bound)

#### Scenario: Drag is clamped at the minimum width

- **GIVEN** the sidebar is open at the default `256px`
- **WHEN** the user drags the handle `-200px` to the left (would
  otherwise reach `56px`)
- **THEN** the final `--sidebar-width` is clamped to `192px` (the
  `12rem` lower bound)

#### Scenario: Keyboard arrow keys resize the sidebar

- **GIVEN** the viewport is `>= 768px`, the sidebar is open at
  `256px`, and the resize handle is focused via Tab
- **WHEN** the user presses `ArrowRight` 4 times
- **THEN** the `--sidebar-width` value progresses `256 → 272 →
  288 → 304 → 320` (one `16px` step per keystroke)

#### Scenario: Shift+arrow keys take larger steps

- **GIVEN** the sidebar is open at `256px` and the handle is
  focused
- **WHEN** the user presses `Shift+ArrowRight` once
- **THEN** the `--sidebar-width` value becomes `320px` (one
  `64px` step)

#### Scenario: Viewport crossing the md breakpoint mid-drag

- **GIVEN** the viewport is `>= 768px`, the user is mid-drag on
  the handle (pointer captured)
- **WHEN** the user shrinks the browser window such that the
  viewport drops below `768px`
- **THEN** the in-progress drag completes via `pointerup` (the
  pointer-capture survives the breakpoint cross)
- **AND** the final width is committed to `localStorage`
- **AND** the handle becomes invisible on the new mobile layout
- **AND** when the user later expands the viewport back to
  `>= 768px`, the persisted width is re-applied

### Requirement: Sidebar width persists to localStorage

The dashboard SHALL persist the user-chosen sidebar width to
`localStorage` under the key `memon:sidebar:width`. The value SHALL
be a string-encoded integer representing the width in CSS pixels.
The value SHALL be:

- read on the client immediately after hydration,
- clamped to the inclusive range `[192, 384]` on read (matching the
  drag handle's clamping), with out-of-range or non-numeric values
  treated as missing,
- applied via the `style` prop of `<SidebarProvider>` as
  `{ '--sidebar-width': '${widthPx}px' }`,
- written back on every commit point (`pointerup` after a drag,
  every keystroke during keyboard resize), best-effort (writes
  swallow exceptions for browser storage quota / private-mode
  errors).

When the localStorage key is absent or its value is unparseable /
out-of-range / non-numeric, the dashboard SHALL fall back to the
shadcn default width (`16rem` ≈ `256px`). The SSR HTML SHALL
render at the default width; the persisted value is applied after
hydration. No SSR fetch of the localStorage value is required.

The persisted width SHALL apply across BOTH `/p/<project>/*` and
`/manage/*` pages — both layouts mount `<SidebarProvider>` and
SHALL receive the same persisted width via the shared client hook
or wrapper component.

The mobile drawer width (the shadcn `SIDEBAR_WIDTH_MOBILE = "18rem"`
constant inside the `Sheet`) SHALL NOT be overridden by the
persisted desktop width — mobile keeps its shadcn default.

#### Scenario: Width survives a reload

- **GIVEN** the user has dragged the sidebar from `256px` to
  `320px`
- **WHEN** the user reloads the page
- **THEN** after hydration the `--sidebar-width` inline style on
  the wrapper is `320px`
- **AND** the sidebar column renders at `320px`

#### Scenario: Width persists across `/p/*` ↔ `/manage/*` navigation

- **GIVEN** the user resizes the sidebar to `300px` while on
  `/p/project-a`
- **WHEN** the user navigates to `/manage/tmux`
- **THEN** the sidebar on `/manage/tmux` also renders at `300px`

#### Scenario: Absent localStorage falls back to default

- **GIVEN** `localStorage` has no `memon:sidebar:width` entry
  (fresh browser profile)
- **WHEN** the page loads
- **THEN** the sidebar renders at the shadcn default `16rem`
  (`256px`)
- **AND** no console warning / error is emitted

#### Scenario: Out-of-range stored value is clamped on read

- **GIVEN** `localStorage.getItem('memon:sidebar:width')` returns
  `"1000"` (stale value from a future build, or manually set)
- **WHEN** the page loads
- **THEN** the sidebar renders at `384px` (the upper bound), not
  at `1000px`

#### Scenario: Non-numeric stored value falls back to default

- **GIVEN** `localStorage.getItem('memon:sidebar:width')` returns
  `"abc"` or `null`
- **WHEN** the page loads
- **THEN** the sidebar renders at the shadcn default `256px`

#### Scenario: Mobile drawer is unaffected by the desktop persisted width

- **GIVEN** the user has persisted a desktop width of `320px`
- **WHEN** the user opens the page on a `< 768px` viewport
- **THEN** the mobile `Sheet` drawer renders at `18rem` (the
  shadcn `SIDEBAR_WIDTH_MOBILE` default), NOT at `320px`

### Requirement: SidebarInset constrains its width via min-w-0

The `<SidebarInset>` mounted alongside `<AppSidebar>` SHALL receive a `min-w-0` className so the inset can shrink below its content's intrinsic min-width.
The inset is a flex item; without `min-w-0`, the browser's
default `min-width: auto` makes the flex item at least as wide as
its content's intrinsic minimum — a wide child (a log viewer, a
wide table, a `<pre>` block of unwrapped output) then pushes the
inset past its flex-share and out beyond the viewport's right
edge.

The wrapper `<div>` that holds `{children}` inside the inset
SHALL also receive `min-w-0` so the constraint propagates one
level deeper. Without it, the same overflow path returns: the
inset shrinks, but the children block inside it does not, and
the children block becomes the overflow source instead.

This requirement applies to BOTH `apps/web/app/p/[project]/layout.tsx`
and `apps/web/app/manage/layout.tsx` — both layouts mount a
`<SidebarInset>` and BOTH SHALL apply the same min-width
constraint. The `/p/<project>/layout` carries
`<SidebarInset className="min-w-0">` with a child
`<div className="min-w-0 flex-1 pb-8">`; the
`/manage/layout` carries the equivalent constraints alongside
its own min-h-0 / overflow-hidden constraints.

Rationale: at the shadcn-default `16rem` sidebar width the
overflow rarely manifests because most viewports have enough
remaining width to absorb wide children. With the new resize
handle (this change's primary feature), users can drag the
sidebar to `24rem` (`384px`) which leaves much less room for the
inset — making the overflow bug surface immediately on pages
with wide content. `min-w-0` on both the inset and the inner
children wrapper is the canonical fix.

#### Scenario: Wide child does not overflow the viewport at large sidebar widths

- **GIVEN** the user has dragged the sidebar to its maximum
  width (`384px`) AND is viewing a page with a wide child (e.g.
  a wide table or `<pre>` block whose intrinsic min-width
  exceeds the remaining flex-share)
- **WHEN** the page renders
- **THEN** the page's rendered width does NOT exceed the
  viewport width; the wide child scrolls inside its own
  container (or is clipped by an internal `overflow-*` rule)
  rather than expanding the inset past its flex-share

#### Scenario: SidebarInset and its children wrapper both carry min-w-0

- **WHEN** the `/p/<project>/layout` renders
- **THEN** the `<SidebarInset>` element's class list includes
  `min-w-0`
- **AND** the immediate `<div>` wrapper around `{children}`
  inside the inset also has `min-w-0` in its class list

#### Scenario: Same constraint applies on the /manage/* layout

- **WHEN** the `/manage/layout` renders (e.g. for `/manage/tmux`)
- **THEN** its `<SidebarInset>` element also carries a class
  list that constrains the inset's width to shrink below
  intrinsic content min-width (e.g. `min-h-0 overflow-hidden`
  combined with a flex-direction parent that already prevents
  horizontal overflow), satisfying the same anti-overflow
  contract as `/p/<project>/layout`
