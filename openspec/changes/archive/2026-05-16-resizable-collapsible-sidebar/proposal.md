## Why

The dashboard's left `AppSidebar` is permanently expanded at a fixed `16rem`
on desktop. There is no visible way for a desktop user to collapse it
(the existing `<SidebarTrigger>` carries `md:hidden`, so it only appears
on `< md` viewports) and no way to resize it (the shadcn primitive sets
`SIDEBAR_WIDTH = "16rem"` as a constant on the wrapper's inline style).
Power users with wide content (long run-dir slugs, exp slugs with long
titles, journal rows) want a narrower sidebar; users on smaller laptop
screens want to hide it entirely while reading the right pane. Both
states need to persist so the choice isn't reset on every reload.

The mobile drawer behavior (`Sheet` overlay triggered by the hamburger
icon) is already correct and stays — this change targets the desktop
experience only.

## What Changes

- Surface the sidebar collapse toggle on desktop viewports (currently
  hidden by `md:hidden`). The keyboard shortcut `Cmd/Ctrl+B` (already
  bound by the shadcn primitive) is kept.
- Add a drag-to-resize handle on the right edge of the sidebar, visible
  only when the sidebar is expanded on viewports `>= md`. Dragging
  updates the `--sidebar-width` CSS variable in real time, bounded by a
  min (`12rem`) and max (`24rem`).
- Persist the user-chosen width to `localStorage` under
  `memon:sidebar:width` (number, pixels). On mount, the persisted value
  is read and applied via `SidebarProvider`'s `style` prop. Absent /
  invalid values fall back to the shadcn default (`16rem`).
- Document the existing shadcn cookie-based collapse persistence
  (`SIDEBAR_COOKIE_NAME = "sidebar_state"`) as an explicit capability
  requirement so future changes can't silently drop it.
- Mobile / `< md` viewports are unaffected: the sidebar renders as a
  `Sheet` overlay (existing behavior) with no resize handle.

Non-changes (out of scope):

- The shadcn `Sidebar` primitive (`apps/web/components/ui/sidebar.tsx`)
  is NOT forked — the resize handle is a SEPARATE overlay component per
  repo `CLAUDE.md` F3. The desktop trigger is surfaced via class /
  placement changes in `app-bar.tsx`, not by editing the primitive.
- The `collapsible` mode stays at the shadcn default `offcanvas` (the
  drawer slides off entirely when collapsed) — matches existing mobile
  behavior. `icon` mode (which keeps a thin icon strip) is NOT adopted;
  rationale lives in design.md.
- No FS-on-disk schema change; no `FS_CONVENTION_VERSION` bump.
- No backend / API surface change. The width is a pure client-side UI
  preference, not surfaced via SSE or any HTTP endpoint.
- No changes to the per-project group expansion state machine
  (`memon:sidebar:expanded`) or the "View more" affordance.

## Capabilities

### New Capabilities

(None — the existing `web-layout` capability covers desktop sidebar
chrome and gains additive requirements.)

### Modified Capabilities

- `web-layout`: gains four ADDED requirements covering (1) the
  desktop-visible collapse toggle, (2) the desktop drag-to-resize
  handle with min/max bounds, (3) the width persistence to
  `localStorage`, and (4) explicit documentation of the existing
  shadcn cookie-based collapse-state persistence. No existing
  requirements are MODIFIED or REMOVED — this change is purely
  additive.

## Impact

- **Affected code** (implementation deferred to apply phase — listed
  here for proposal-completeness):
  - `apps/web/components/app-bar.tsx`: remove or amend the
    `className="md:hidden"` on `<SidebarTrigger />` so the trigger is
    visible on `>= md` viewports too. Settle exact placement (in
    AppBar vs. inside sidebar header vs. floating at the inset edge)
    in design.md.
  - `apps/web/app/p/[project]/layout.tsx` and
    `apps/web/app/manage/layout.tsx`: read the persisted width from
    `localStorage` on the client (or via a tiny client wrapper) and
    pass it through `SidebarProvider`'s `style` prop as
    `{ '--sidebar-width': '<persisted>px' }`. The provider already
    spreads `style` after its defaults so the override wins.
  - NEW: `apps/web/components/sidebar-resize-handle.tsx` — a thin
    overlay component that absolute-positions itself against the
    sidebar's right edge, listens for `pointerdown` / `pointermove` /
    `pointerup`, writes the new width back to localStorage on
    `pointerup`, and during drag updates the `--sidebar-width` token
    on the wrapper inline. Hidden on `< md` and when the sidebar is
    collapsed.
  - NEW (recommended): `apps/web/hooks/use-sidebar-width.ts` — a
    small client hook that owns the localStorage read/write and
    exposes `width` + `setWidth` so the layout and the resize handle
    share one source of truth.
- **Affected specs**:
  `openspec/specs/web-layout/spec.md` — gains four ADDED requirements
  via the delta in
  `openspec/changes/resizable-collapsible-sidebar/specs/web-layout/spec.md`.
- **No API changes**. No new endpoints; no changes to existing
  endpoints. No SSE topics. No TanStack query keys.
- **No FS_CONVENTION_VERSION involvement** — pure UI preference.
- **No new dependencies**. The drag handle is a few lines of vanilla
  pointer-event listeners; no `react-resizable-panels` or similar.
- **Test impact**: small. A new component-level test for the resize
  handle's min/max clamping and a small DOM-level test for the desktop
  trigger visibility class. No existing tests should regress.
- **Verification protocol (CLAUDE.md F1 / F4) is baked into the
  apply-phase task list**: curl the rendered page to confirm the new
  resize-handle markup exists; grep the compiled CSS to confirm any
  new tokens (e.g. the handle's hover ring) resolve; cross-check
  `globals.css` for `--sidebar-*` tokens that the new code touches.
