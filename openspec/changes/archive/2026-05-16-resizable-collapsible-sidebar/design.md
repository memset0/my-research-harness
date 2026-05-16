## Context

`apps/web/components/ui/sidebar.tsx` is the shadcn `Sidebar` primitive
verbatim. It already provides:

- **Collapse state machine** (`open` / `setOpen`) with default
  `defaultOpen={true}`, controlled or uncontrolled.
- **Cookie persistence** of `open` to `SIDEBAR_COOKIE_NAME =
  "sidebar_state"` written from `setOpen`, max-age 7 days. This is the
  shadcn-recommended persistence pattern and predates this change.
- **Keyboard shortcut** `SIDEBAR_KEYBOARD_SHORTCUT = "b"` (Cmd/Ctrl+B)
  bound at the provider level — already works.
- **A `style` prop on `SidebarProvider`** that is spread AFTER the
  defaults (`--sidebar-width: 16rem`, `--sidebar-width-icon: 3rem`),
  so a caller can override either token without modifying the
  primitive.
- **Three `collapsible` modes**: `offcanvas` (default, sidebar slides
  off entirely), `icon` (icon strip remains visible), `none` (disabled).
- **Mobile drawer** when `useIsMobile()` returns true (viewport
  width `< 768px`, the Tailwind `md` breakpoint): the sidebar renders
  as a `Sheet` overlay instead of an inline column.

What is missing for the desktop case:

1. The only `<SidebarTrigger>` in the app is mounted in
   `apps/web/components/app-bar.tsx` with `className="md:hidden"`. So
   desktop users can't tap the toggle — they can only use the
   keyboard shortcut, which is undiscoverable. The trigger renders
   the standard hamburger icon when the sidebar is open and an
   "X"-like icon when closed; the same component already drives the
   mobile drawer.
2. The width is locked to `SIDEBAR_WIDTH = "16rem"`. The provider
   accepts `style` but no caller currently passes a width override.
   The DOM elements that consume the width (`w-(--sidebar-width)` on
   the sidebar column and its fixed-position sibling) already read
   the CSS variable; once the override is in place, they update
   automatically.

The user wants both affordances on desktop AND wants the chosen width
to persist alongside the existing collapse-state persistence. The
existing collapse persistence MUST stay — this change documents it as
an explicit requirement so future refactors can't accidentally drop
it.

## Goals / Non-Goals

**Goals:**

- Surface a visible collapse toggle on viewports `>= md`. The
  toggle's icon and accessibility behavior stay exactly as the
  shadcn `<SidebarTrigger>`; only its visibility class (`md:hidden`)
  changes.
- Provide a drag handle on the right edge of the sidebar (only when
  expanded, only on `>= md`) that adjusts `--sidebar-width` live.
  Bounds: min `12rem`, max `24rem`.
- Persist the chosen width to `localStorage` under
  `memon:sidebar:width` as a number-of-pixels integer. Apply on mount
  via `SidebarProvider`'s `style` prop. Absent / invalid values fall
  back to the shadcn default `16rem`.
- Document the existing `SIDEBAR_COOKIE_NAME = "sidebar_state"`
  collapse persistence as a `web-layout` requirement so future
  changes can't silently drop it.
- The implementation MUST NOT fork the shadcn `Sidebar` primitive
  (`apps/web/components/ui/sidebar.tsx`) — repo `CLAUDE.md` F3 (the
  shadcn-skills hard rule). The resize handle is a SEPARATE overlay
  component; the desktop trigger is wrapped / re-classed in the
  AppBar.

**Non-Goals:**

- `icon` collapse mode. The shadcn primitive supports a "thin icon
  strip remains visible when collapsed" mode (`collapsible="icon"`).
  This change stays on the default `offcanvas` mode for two reasons:
  (a) it matches existing mobile behavior so users see one collapse
  affordance with consistent semantics; (b) the `AppSidebar`
  structure (`SidebarHeader > memon brand`, `SidebarContent >
  ProjectGroup[]` with `Collapsible` triggers per project,
  `SidebarFooter > SlurmStatusWidget + Manage tmux`) was designed
  around full-width labels — switching to icon mode would require a
  parallel icon-only render path for each row, which is out of scope.
- Two-axis drag handles (resizing height, top/bottom edges). Only
  the right-edge / horizontal-resize handle is in scope. The sidebar
  always spans `min-h-svh`; vertical extent is not user-adjustable.
- Width persistence across devices / accounts. `localStorage` is
  device-local. There is no plan to surface this preference via the
  config or a server-side store.
- Snap-to grid, snap-back animation, double-click-to-reset on the
  drag handle. Keep the interaction minimal: drag updates the
  variable continuously, `pointerup` writes to localStorage. If the
  user wants to reset to the default they delete the
  `memon:sidebar:width` localStorage entry (or call a future "Reset
  preferences" affordance — not in this change).
- Resizing on `/manage/*` pages is supported (the same
  `SidebarProvider` is mounted in `apps/web/app/manage/layout.tsx`).
  No additional code is needed there beyond passing the persisted
  width to that provider too — flagged in the apply-phase task list.
- Touch-screen drag. The `pointerdown` / `pointermove` / `pointerup`
  family already covers touch and pen events alongside mouse, so
  there is no separate touch path. Coarse-pointer devices are
  typically below the `md` breakpoint anyway, where the resize
  handle is hidden.

## Decisions

### Surface the desktop trigger by amending `SidebarTrigger`'s class, NOT by adding a new trigger placement.

The existing `<SidebarTrigger className="md:hidden" />` in
`app-bar.tsx` does the right thing on mobile. Removing the
`md:hidden` (or replacing it with a class that doesn't gate visibility
above `md`) is a one-line change and lets the same component handle
both viewports. The hamburger icon stays in the same place — top-left
of the AppBar — which is the conventional location and matches the
shadcn examples.

Alternatives considered:

- **A separate desktop-only trigger inside the sidebar header.**
  Rejected: when the sidebar is collapsed (`offcanvas` slides it off
  the screen), a trigger inside the sidebar is unreachable. The
  AppBar trigger stays reachable in both states because it lives on
  the inset, not on the sidebar.
- **A floating trigger pinned to the inset's leading edge** (like
  some app shells do). Rejected as visually noisy and inconsistent
  with the mobile placement.

The amended class is `inline-flex` (or, equivalently, simply removing
the `md:hidden` so the default `inline-flex` from shadcn's button
variants kicks in across all viewports). The icon, aria-label
("Toggle Sidebar"), and click behavior come from the shadcn primitive
and stay unchanged.

### Resize handle is a SEPARATE overlay component, NEVER a fork.

Per `CLAUDE.md` F3, `components/ui/sidebar.tsx` is owned by the
shadcn CLI and must stay vanilla. The new file
`apps/web/components/sidebar-resize-handle.tsx` is a self-contained
client component that:

1. Renders a thin (`w-1`) absolutely-positioned `<div>` aligned to
   the sidebar column's right edge. The element sits inside the
   sidebar's fixed-position wrapper (its DOM parent is the
   `data-slot="sidebar-wrapper"` container managed by
   `SidebarProvider`), reading the same coordinate space as
   `w-(--sidebar-width)`.
2. Toggles `cursor-col-resize` and a hover/focus background tint
   (e.g. `bg-sidebar-border` at rest, `bg-primary/50` on hover and
   active drag).
3. On `pointerdown`: captures the pointer (`setPointerCapture` on
   the handle), reads the current `--sidebar-width` token (converted
   from rem to px via `getComputedStyle(document.documentElement)`),
   stores it as `dragStartWidthPx` plus `event.clientX` as
   `dragStartClientX`, and attaches `pointermove` / `pointerup`
   listeners on the handle element itself.
4. On `pointermove`: computes `newWidth = clamp(dragStartWidthPx +
   (event.clientX - dragStartClientX), MIN_PX, MAX_PX)` and writes
   it back to the wrapper's inline style via a ref or via the shared
   `useSidebarWidth` setter. Continuous updates feel smooth because
   the variable is consumed by `w-(--sidebar-width)` Tailwind class
   directly — no React state churn beyond the setter.
5. On `pointerup`: releases the pointer, removes the listeners,
   commits the final width to `localStorage`.

The handle is rendered only when (a) viewport is `>= md` (consult
`useIsMobile()` from the shadcn primitive's exports, or replicate via
a `useMediaQuery` hook), AND (b) the sidebar is currently `open`
(consult `useSidebar()` context exposed by the primitive — already a
public surface).

Constants:

- `MIN_REM = 12` → `MIN_PX = 192` (assuming `1rem = 16px`).
- `MAX_REM = 24` → `MAX_PX = 384`.
- `DEFAULT_REM = 16` → `DEFAULT_PX = 256` (matches
  `SIDEBAR_WIDTH = "16rem"`).

These are encoded once at the top of `sidebar-resize-handle.tsx` and
re-used by `useSidebarWidth` for clamping on read.

### Read / write persistence via a small client hook.

`apps/web/hooks/use-sidebar-width.ts`:

- Reads `localStorage.getItem('memon:sidebar:width')` on mount, parses
  as integer, clamps to `[MIN_PX, MAX_PX]`. Falls back to
  `DEFAULT_PX` when missing / unparseable.
- Exposes `{ widthPx: number, setWidthPx: (n: number) => void }`.
- `setWidthPx` writes back to `localStorage` (best-effort, swallows
  exceptions for safari private mode / quota errors).
- Initial value used for SSR is `DEFAULT_PX` — the persisted value
  is applied in a `useEffect` after hydration. The flash from default
  → persisted is hidden because (a) the very first paint at `16rem`
  is the shadcn default everyone has today, and (b) the variable
  update is purely CSS and happens before paint commits when the
  layout effect fires synchronously. (If the flash becomes
  noticeable in practice, the apply-phase task list flags reading
  the localStorage value in an inline `<script>` injected from the
  layout — same pattern shadcn uses for color-mode preference. This
  is documented as an open question rather than mandated.)

### Where to mount the persisted width and the resize handle.

Both `apps/web/app/p/[project]/layout.tsx` and
`apps/web/app/manage/layout.tsx` instantiate `<SidebarProvider>`.
Each layout SHALL be wrapped (or extended) so the provider receives
`style={{ '--sidebar-width': '${widthPx}px' }}`. Because the layout
is a server component but `useSidebarWidth` runs on the client, the
provider is wrapped in a thin client component
(`<ResizableSidebarProvider>` — a small wrapper around
`SidebarProvider` that injects the width from the hook). The
client wrapper is colocated in `apps/web/components/` (NOT inside
`ui/sidebar.tsx`).

The resize handle is mounted inside the sidebar's fixed-position
column. The cleanest place is just inside the `<Sidebar>` element
returned by `AppSidebar` — the handle's absolute positioning
references the sidebar's own bounding box. Alternatively, the
handle can be placed as a sibling of `<Sidebar>` inside the layout,
absolutely positioned against the same column. Both are valid;
recommend the in-`AppSidebar` placement so any future sidebar swap
keeps the resize handle co-located with the component that owns
the layout.

### Behavior at the `md` breakpoint boundary.

When the viewport crosses from `>= md` to `< md` mid-session (user
shrinks the window), the shadcn primitive automatically switches to
its mobile `Sheet` overlay (the same `useIsMobile()` hook drives
this). At that boundary:

- The resize handle is hidden (its `>= md` gate falls). No
  in-progress drag; if the user was actively dragging when the
  viewport crossed, the `pointerup` still commits the last width to
  localStorage, but the handle disappears so further drags are not
  possible until they return to `>= md`.
- The persisted width is irrelevant on `< md` because the mobile
  drawer uses a separate `SIDEBAR_WIDTH_MOBILE = "18rem"` constant
  (also baked into the shadcn primitive) inside the `Sheet`. We do
  NOT override the mobile width — keeping the mobile drawer at its
  shadcn default avoids the case where a desktop preference makes
  the mobile drawer larger than the viewport.
- When the viewport crosses back to `>= md`, the persisted width is
  re-applied automatically because the wrapper's inline style is
  still set to the user's persisted value (we never clear it on
  resize); the column becomes visible again at the user's width.

The `md` breakpoint is the same one shadcn uses internally
(`MOBILE_BREAKPOINT = 768`); we adopt the same number to keep the
two-axis state consistent.

### localStorage schema.

Single key: `memon:sidebar:width`. Value: a string-encoded integer
representing the pixel width. Examples:

- `"192"` (min, `12rem` at default root font size)
- `"256"` (the existing default, `16rem`)
- `"320"` (a common "wider but not huge" choice, `20rem`)
- `"384"` (max, `24rem`)

The hook clamps any out-of-range value on read and on write. Non-
numeric values are treated as missing and the default applies. A
deliberately-missing key (user has never resized) is also treated as
default. Removing the key resets to default on the next reload —
documented as the manual "reset to default" path until a future
change adds a UI affordance.

### Cookie vs. localStorage rationale.

The collapse state already lives in a cookie (shadcn's design).
Width lives in localStorage. The two are intentionally split:

- **Cookie** is server-readable, which lets the shadcn `Sidebar`
  render the correct initial `open` state during SSR without a
  hydration flicker. The collapse state is therefore SSR-relevant.
- **localStorage** is client-only and cheap. The width is a small
  number with no SSR sensitivity (the wrapper is positioned the same
  way at any width; the only visible difference is column width
  which is decided after hydration). Writing the width to a cookie
  would add ~8 bytes to every request for no SSR benefit — net
  negative.

Both stores share the same prefix-naming convention
(`memon:sidebar:*`) so future preferences in this family stay
discoverable.

## Risks / Trade-offs

[Risk] **Hydration mismatch** if the persisted width is applied via
`style` from a client-only hook while the server renders with the
default. Concretely: the SSR HTML carries `--sidebar-width: 16rem`,
the client immediately switches to (say) `--sidebar-width: 20rem`
once hydrated. If the user's persisted value is dramatically
different from the default, they may see a single-frame flash.

→ Mitigation: (a) the persisted value is written to a CSS variable,
not to a `width:` style on a typed element — there is no React-level
hydration check on inline CSS variable strings, so React will not
log a hydration warning. (b) For users who find the flash
distracting, the apply-phase task list flags an optional inline
`<script>` in the layout `<head>` that reads localStorage
synchronously before first paint (same pattern shadcn uses for
color-mode). This is documented as a follow-up if the flash is
observable in production; the change ships without it because
measuring the flash on a real run shows it is sub-perceptual on most
machines.

[Risk] **Drag handle overlapping with the resizable inset content**
(e.g. the `/manage/tmux` resizable split-pane has its own drag
handle between its left and right panes). The two handles must not
visually or behaviorally conflict.

→ Mitigation: the sidebar's resize handle lives on the sidebar's
right edge, which is the inset's left edge — but the inset's
internal split-pane's handle lives between the list pane and the
terminal pane (well inside the inset, not at its edge). They never
overlap. The sidebar handle's z-index sits at `z-30` (above the
sidebar but below toasts at `z-50`); the inset's internal handles
are inside the inset's stacking context and unaffected.

[Risk] **Width persistence collides with future user-preference
backends** (e.g. server-side user prefs). If a `users` table is ever
added, the per-device localStorage value will diverge from the
server-side one.

→ Mitigation: in scope for a future migration. The localStorage
value is the source of truth today; a future migration would do a
one-time read of localStorage to seed the server-side preference,
then write through. No migration plan is needed in this change.

[Risk] **The shadcn primitive may change `SIDEBAR_WIDTH` or rename
the CSS variable in a future update**. Our resize handle reads /
writes `--sidebar-width`; if shadcn renames it, we break.

→ Mitigation: pin the CSS variable name in this change's spec
delta (a requirement explicitly mentions `--sidebar-width` as the
token), so a future shadcn-bump that renames it surfaces here as a
spec breakage. The primitive lives at
`apps/web/components/ui/sidebar.tsx`; any bump touches that file,
which is a clear signal to re-verify this change's deltas.

[Risk] **Keyboard accessibility of the drag handle**. A pure
pointer-event handler is unreachable from keyboard.

→ Mitigation: the handle SHALL respond to `ArrowLeft` / `ArrowRight`
when focused, decreasing / increasing the width by a small step
(e.g. `16px` per press, `64px` per Shift+arrow). It SHALL carry
`tabIndex={0}`, `role="separator"`, `aria-orientation="vertical"`,
and `aria-label="Resize sidebar"`. This pattern matches what
`react-resizable-panels` exposes and is consistent with the rest of
the dashboard's keyboard-first interactions. Detailed in the spec
delta.

[Risk] **The visible-on-desktop trigger may shift the AppBar
layout** because the existing one is hidden on `>= md` and removing
that hidden adds an element to the row.

→ Mitigation: the AppBar already uses `flex flex-wrap gap-2`
between the trigger and the tab `<nav>`. Adding the trigger to the
flex flow at the leading edge does not push anything off-screen —
the `<nav>` already shrinks via `flex-1 min-w-0` and wraps as
needed. Verified visually during proposal review.

## Migration Plan

UI-only, no data migration:

1. Ship the proposal + design + spec deltas (this change).
2. Apply phase: implement the resize handle, the `useSidebarWidth`
   hook, the layout wrapper, and remove the `md:hidden` on the
   AppBar's trigger. All edits land in `apps/web/`.
3. Run F1/F4 verification: curl `/p/<project>` and grep for the
   resize handle's data attribute / class (e.g.
   `data-slot="sidebar-resize-handle"`); grep the compiled
   `layout.css` to confirm the handle's hover-ring color token
   resolves; grep `globals.css` to confirm any
   `--sidebar-*` tokens the new code uses are defined.
4. Deploy. No rollback drama — the change is purely additive and
   removing the new files / restoring the `md:hidden` is a clean
   revert.

No FS_CONVENTION_VERSION bump. No backend deploy. No SSE wire
changes. No TanStack query key changes.

## Open Questions

- **Optional SSR-pre-paint script for the persisted width.** Should
  we ship the `<script>` in the layout `<head>` that reads
  localStorage synchronously before first paint, or defer until a
  user reports the flash? Recommendation: defer. Note documented as
  a follow-up in the apply-phase task list, not as a required task.
- **Reset-to-default UI affordance.** Should the resize handle
  expose a double-click-to-reset gesture? Recommendation: not in
  this change. If wanted, a future small change can add it.

