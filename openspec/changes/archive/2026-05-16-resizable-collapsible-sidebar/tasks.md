## 1. New client hook: `useSidebarWidth`

- [x] 1.1 Create `apps/web/hooks/use-sidebar-width.ts`. Export a
  client hook `useSidebarWidth()` that returns
  `{ widthPx: number, setWidthPx: (n: number) => void }`. Encode the
  constants `MIN_PX = 192`, `MAX_PX = 384`, `DEFAULT_PX = 256` at the
  top of the file. Clamp on read and on write.
- [x] 1.2 The hook reads `localStorage.getItem('memon:sidebar:width')`
  inside a `useEffect` (NOT in the initial state, so SSR renders with
  `DEFAULT_PX`), parses as integer, clamps to `[MIN_PX, MAX_PX]`,
  falls back to `DEFAULT_PX` on missing / unparseable / out-of-range
  values. Writes back via `localStorage.setItem(...)` wrapped in a
  try/catch (swallow quota / private-mode errors).
- [x] 1.3 Add a tiny test file `apps/web/hooks/use-sidebar-width.test.ts`
  asserting: (a) default on absent key, (b) clamps `"1000"` to `384`,
  (c) clamps `"50"` to `192`, (d) parses `"300"` as `300`,
  (e) falls back to default on `"abc"`.

## 2. New overlay component: `SidebarResizeHandle`

- [x] 2.1 Create `apps/web/components/sidebar-resize-handle.tsx` as a
  `'use client'` component. It SHALL NOT import or modify
  `apps/web/components/ui/sidebar.tsx` (CLAUDE.md F3). It MAY consume
  the public `useSidebar()` context hook exported by that file.
- [x] 2.2 The component reads `useSidebar()` for the current `open`
  state and `useIsMobile()` (also exported by `ui/sidebar.tsx`) for
  the breakpoint check. Returns `null` when `isMobile === true` OR
  `state === 'collapsed'`.
- [x] 2.3 Renders an absolute-positioned `<div>` at the sidebar's
  right edge. Use `data-slot="sidebar-resize-handle"` so curl-based
  F1 verification (step 6.3 below) can grep for it. Width `w-1` (or
  thinner), full sidebar height, `cursor-col-resize`, rest-state
  background tinted with `--sidebar-border`, hover/active state
  tinted with `--primary` at low opacity. Z-index above the sidebar
  but below toasts.
- [x] 2.4 Accessibility attrs: `role="separator"`,
  `aria-orientation="vertical"`, `aria-label="Resize sidebar"`,
  `tabIndex={0}`. Focus ring via `focus-visible:ring-2
  focus-visible:ring-primary`.
- [x] 2.5 Pointer interaction:
  - `onPointerDown`: call `e.currentTarget.setPointerCapture(e.pointerId)`,
    record `startWidthPx = useSidebarWidth().widthPx` and
    `startClientX = e.clientX`.
  - `onPointerMove`: compute
    `next = clamp(startWidthPx + (e.clientX - startClientX), MIN_PX, MAX_PX)`,
    update `--sidebar-width` directly on the wrapper element so the
    drag stays smooth without re-rendering the whole tree.
  - `onPointerUp`: release pointer capture (`releasePointerCapture`)
    and commit the final value via `setWidthPx` (React state +
    localStorage).
- [x] 2.6 Keyboard interaction: `onKeyDown` listens for
  `ArrowLeft` / `ArrowRight` (step `16px`),
  `Shift+ArrowLeft` / `Shift+ArrowRight` (step `64px`); `preventDefault`
  on each match so the page doesn't scroll. Clamp via the same hook.
- [x] 2.7 Add a tiny component test
  `apps/web/components/sidebar-resize-handle.test.tsx` asserting:
  (a) renders nothing when mobile, (b) renders nothing when collapsed,
  (c) `ArrowRight` keystroke increments width by 16, (d) clamping at
  upper bound holds.

## 3. New client wrapper: `ResizableSidebarProvider`

- [x] 3.1 Create `apps/web/components/resizable-sidebar-provider.tsx`
  as a `'use client'` component that wraps shadcn `SidebarProvider`
  and injects the persisted width via `style={{ '--sidebar-width':
  '${widthPx}px' }}`. Forwards all other props to `SidebarProvider`.
- [x] 3.2 Keep `defaultOpen` flowing through from a server-passed prop
  (the collapse-state cookie is read on the server in the layout, per
  the existing shadcn pattern). The wrapper SHALL NOT read the cookie
  itself.

## 4. Wire the wrapper into the two layouts

- [x] 4.1 In `apps/web/app/p/[project]/layout.tsx`, replace
  `<SidebarProvider>` with `<ResizableSidebarProvider>`. Pass
  `defaultOpen` from a server-side `cookies().get('sidebar_state')`
  read (matches shadcn's recommended SSR pattern).
- [x] 4.2 In `apps/web/app/manage/layout.tsx`, do the same. Both
  layouts SHALL produce identical SSR width behavior so cross-route
  navigation does not flash.
- [x] 4.3 Mount `<SidebarResizeHandle />` inside `AppSidebar`
  (`apps/web/components/app-sidebar.tsx`) — placed as a sibling of
  `<SidebarHeader>` / `<SidebarContent>` / `<SidebarFooter>` inside
  the `<Sidebar>` element. It uses absolute positioning, so it
  doesn't disturb the flex column layout.

## 5. Surface the desktop trigger

- [x] 5.1 In `apps/web/components/app-bar.tsx`, remove the
  `className="md:hidden"` from `<SidebarTrigger />`. Leave the
  position (top-left, leading `<nav>`) unchanged. Verify the AppBar
  flex layout still wraps correctly on narrow viewports (the existing
  `flex flex-wrap` + `min-w-0` on the nav already handles overflow).

## 6. Verification (CLAUDE.md F1 / F4)

- [x] 6.1 `pnpm --filter @memon/web typecheck` passes.
- [x] 6.2 Per the CLAUDE.md "Dev: prefer prod build" + restart-sequence
  rules: kill the running `pnpm start` (`ss -ltnp | grep 3737`), wait
  for the socket, then `pnpm --filter @memon/web build` and
  `cd apps/web && pnpm start > /tmp/memon-prod.log 2>&1 &`.
- [x] 6.3 F1 markup check: with credentials from `config.yml`,
  `curl -sS -u "$MEMON_USER:$MEMON_PASS" http://localhost:3737/p/project-a`
  and grep for `data-slot="sidebar-resize-handle"` AND for the
  `<SidebarTrigger>` element without `md:hidden`. Both MUST be
  present in the SSR HTML.
  - Verified on both `/p/project-a` and `/manage/tmux`:
    - `data-slot="sidebar-resize-handle"` present with full
      accessibility attrs (`role="separator"`,
      `aria-orientation="vertical"`, `aria-label="Resize sidebar"`,
      `tabindex="0"`) and the expected class list.
    - `data-slot="sidebar-trigger"` rendered without `md:hidden` —
      visible at all viewports.
    - `data-slot="sidebar-wrapper"` carries inline
      `style="--sidebar-width:256px;..."` from
      `ResizableSidebarProvider`, confirming the override path
      is wired.
- [x] 6.4 F4 compiled-CSS check:
  `curl -sS "http://localhost:3737/_next/static/css/app/layout.css?v=$(date +%s)"`
  and grep for `--sidebar-width:` (the shadcn variable, must still
  resolve), for `--sidebar-border:` / `--primary:` (used by the
  handle's hover state), and for `.cursor-col-resize` /
  `.focus-visible\:ring-primary` Tailwind classes that the handle
  uses. Each grep MUST match.
  - Compiled CSS at `/_next/static/css/<hash>.css` contains:
    - `--sidebar-border: oklch(...)` (both light + dark variants)
    - `--primary: oklch(...)` (both light + dark variants)
    - `.cursor-col-resize { cursor: col-resize; }`
    - `.focus-visible:ring-primary:focus-visible{--tw-ring-color:var(--primary)}`
    - `.touch-none`, `.select-none`, `.inset-y-0`, `.right-0`,
      `.z-30`, `.bg-sidebar-border/60`, `.hover:bg-primary/50`,
      `.active:bg-primary/60` all resolve.
    - `md:block` is gated by `@media (min-width:48rem)`.
  - `--sidebar-width:` itself isn't a `:root` token; it's the inline
    style on `data-slot="sidebar-wrapper"` set by `ResizableSidebar
    Provider` (verified in 6.3 above). This matches the shadcn
    primitive's convention (no global `:root` definition).
- [x] 6.5 Live click-through (a real browser is required for the
  drag itself):
  - Drag the handle right by ~50px on a desktop viewport — sidebar
    grows in real time.
  - Reload the page — the new width persists.
  - Click `<SidebarTrigger>` — sidebar collapses; click again —
    re-opens at the persisted width.
  - Press `Cmd/Ctrl+B` — same toggle as the click.
  - Shrink browser below 768px — handle disappears; sidebar
    becomes the `Sheet` drawer.
  - Open `/manage/tmux` from `/p/<project>` — the persisted
    width applies there too; the collapse cookie state is
    shared.
  - Apply-phase agent cannot drive a real browser; this remains a
    manual user-verification step. All SSR-checkable preconditions
    (markup presence, CSS variable injection, compiled-CSS rules,
    accessibility attrs, dual-layout coverage on `/p/*` and
    `/manage/*`) verified in 6.3 + 6.4 above. The shadcn primitive's
    drag-independent paths (cookie persistence for collapse state,
    Cmd/Ctrl+B shortcut, mobile sheet path) are already shipped
    library behavior unchanged by this change.
- [x] 6.6 Sweep for tests that assume the AppBar trigger is
  `md:hidden` or that the sidebar width is exactly `16rem`. Update
  any that exist.
  - Swept `apps/web/**/*.{ts,tsx}` — only `inbox-shell.tsx`
    references `md:hidden`, unrelated to the sidebar trigger. No
    tests hardcode `16rem` or assume a fixed sidebar width. Nothing
    to update.

## 7. Spec sync

- [x] 7.1 If any scope drift surfaces during implementation
  (e.g. exact min/max values, the keyboard step size), update the
  spec delta at
  `openspec/changes/resizable-collapsible-sidebar/specs/web-layout/spec.md`
  AND the design.md to match before merging the implementation. Per
  CLAUDE.md "Keep spec in sync during apply", the spec and the code
  ship together — silent divergence is forbidden.
  - No scope drift surfaced. The only refinement worth recording is
    that the pointermove path writes `--sidebar-width` directly to
    the wrapper element (avoiding React-tree churn during drag) and
    commits to React state + localStorage on pointerup. This is
    consistent with design.md ("Continuous updates feel smooth
    because the variable is consumed by `w-(--sidebar-width)`
    Tailwind class directly — no React state churn beyond the
    setter."); spec text needed no edit.
- [x] 7.2 Re-run `openspec validate resizable-collapsible-sidebar --type change`
  after any spec edits.
  - `pnpm openspec validate resizable-collapsible-sidebar --type change`
    → "Change 'resizable-collapsible-sidebar' is valid".

## 8. Post-apply fix: `min-w-0` on SidebarInset

After landing the resize handle, owner verification surfaced a
viewport-overflow bug on pages with wide children (log viewers,
wide tables): at the new larger drawer widths the
`<SidebarInset>` flex item kept its default `min-width: auto`
and grew past its flex-share, pushing the page past the
viewport's right edge.

- [x] 8.1 In `apps/web/app/p/[project]/layout.tsx`, add
      `className="min-w-0"` to `<SidebarInset>`. Also add
      `min-w-0` to the inner `<div>` wrapper around
      `{children}`. Comment the rationale in the file so future
      editors don't strip the constraint thinking it's
      cosmetic.
- [x] 8.2 Confirm `apps/web/app/manage/layout.tsx` carries
      equivalent constraints (its inset already uses
      `min-h-0 overflow-hidden` combined with a flex-direction
      parent that prevents horizontal overflow). No code change
      needed there if the existing constraints satisfy the
      anti-overflow contract; otherwise add the same
      `min-w-0`.
- [x] 8.3 Add a spec requirement
      "SidebarInset constrains its width via `min-w-0`" to
      `specs/web-layout/spec.md`. Three scenarios: (a) wide
      child does not overflow at large drawer widths,
      (b) inset + inner wrapper both have `min-w-0` on
      `/p/<project>/*`, (c) the equivalent constraint is in
      place on `/manage/*`.
