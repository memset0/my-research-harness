## 1. Install shadcn Resizable primitive

- [x] 1.1 Run `pnpm dlx shadcn@latest add resizable --yes` from `apps/web`. Verify it creates `apps/web/components/ui/resizable.tsx` and adds `react-resizable-panels` to `apps/web/package.json` dependencies. Do NOT hand-edit the file — the shadcn output is the canonical content.
- [x] 1.2 `pnpm install` at repo root to materialize the new dep into the workspace lockfile.
- [x] 1.3 `pnpm --filter @memon/web typecheck` SHALL pass — confirms react-resizable-panels' types resolve under the existing tsconfig.

## 2. Lightweight helpers

- [x] 2.1 Add a tiny `useLocalStorageState` hook (or inline equivalent) somewhere appropriate (suggest `apps/web/lib/use-local-storage-state.ts`). Must: read on mount, write on change (debounced ~250ms), no-op gracefully when `localStorage` throws. Generic over JSON-serializable shapes.
- [x] 2.2 Add a tiny `useMediaQuery` hook (or use one already in repo if present — quickly grep first). Returns `false` on SSR; flips to the real match on hydration. Suggest `apps/web/lib/use-media-query.ts`. Keep it 20-ish lines.
- [x] 2.3 In `apps/web/app/manage/tmux/tmux-page.client.tsx`, add a local `categorize(row: TmuxSessionRow): { category: Category; title: string }` helper per design.md D9. Define `type Category = 'manual' | 'run' | 'exp' | 'project' | 'legacy' | null`. The function does the strip-and-classify in one pass.

## 3. CategoryBadge component (local to tmux page)

- [x] 3.1 In `tmux-page.client.tsx`, define a local `CategoryBadge({ category })` component that returns a small chip with the color mapping from design.md D9. Use `cn()` and explicit Tailwind class strings — do NOT introduce a new shared component (per CLAUDE.md F3, never fork shadcn primitives; this is its own component, not a shadcn wrapper).
- [x] 3.2 The category badge component renders `null` if `category === null`. Stale rows pass `category` as-is BUT the wrapper card applies an `opacity-75` style so the muted look reads even when category is `run`/`exp`.

## 4. Page layout: split-pane shell

- [x] 4.1 In `apps/web/app/manage/tmux/page.tsx`, drop the `<div className="mx-auto max-w-[1400px] p-6">` wrapper. Render the client component directly inside `<HydrationBoundary>`.
- [x] 4.2 In `apps/web/app/manage/layout.tsx`, change the `<SidebarInset>`'s inner `<div className="flex-1">` to `<div className="flex min-h-0 flex-1 flex-col">` (using `min-h-0` rather than `h-[100dvh]` — SidebarInset already provides the available height via `flex-1`, all we need is the `min-h-0` to let children own the remaining space). Verify other `/manage/*` pages (none currently exist but the route segment is open-ended) still look right; document the assumption.
- [x] 4.3 In `tmux-page.client.tsx`, replace the entire returned JSX. New top-level structure:
   ```tsx
   const isDesktop = useMediaQuery('(min-width: 768px)')
   const [sizes, setSizes] = useLocalStorageState<number[]>(
     'memon:manage-tmux:split-sizes',
     isDesktop ? [30, 70] : [45, 55],
   )
   return (
     <ResizablePanelGroup
       direction={isDesktop ? 'horizontal' : 'vertical'}
       onLayout={(s) => setSizes(s)}
       className="h-full w-full"
     >
       <ResizablePanel defaultSize={sizes[0] ?? 30} minSize={isDesktop ? 18 : 25}>
         <LeftPane ... />
       </ResizablePanel>
       <ResizableHandle withHandle />
       <ResizablePanel defaultSize={sizes[1] ?? 70} minSize={isDesktop ? 35 : 25}>
         <RightPane ... />
       </ResizablePanel>
     </ResizablePanelGroup>
   )
   ```
- [x] 4.4 Decide where `LeftPane` and `RightPane` live. Suggest: both stay inline in `tmux-page.client.tsx` for now (the file is the only consumer); split into separate files only if either grows past ~250 LOC.

## 5. Left pane: card list

- [x] 5.1 Implement `LeftPane`: renders the sticky header (`tmux sessions` title + filter `Tabs` + `New session` Button + `Refresh` Button) and a scrolling list area below. The list area is `flex-1 overflow-y-auto`.
- [x] 5.2 The header controls retain the existing behavior — filter state lifted from the previous table page, mutations unchanged. The New session Dialog markup moves into LeftPane (or is rendered at the page level — either works, easier to keep inside LeftPane since it's owned by LeftPane's button). [kept Dialogs at the page level since they're modal not pane-scoped]
- [x] 5.3 Implement `SessionCard` component (local). Props: `row: TmuxSessionRow`, `selected: boolean`, `onSelect(name): void`, `onAskKill(name): void`. Renders:
   - Top line: `<CategoryBadge category={categorize(row).category} />` + title text + action group on the right.
   - Second line: relative time (`X ago`) in muted text.
   - Third line: inline metadata badges per design.md D10 — only rendered when the corresponding value is non-null.
   - Top-level card has `role={stale ? undefined : 'button'}`, `tabIndex={stale ? -1 : 0}`, click + keyboard (Enter / Space) handlers calling `onSelect(sessionName)` when not stale.
   - When `selected`: add accent background (`bg-accent`) and a left-border accent (`border-l-2 border-l-primary`).
   - When stale: `opacity-75` and the entire card is non-interactive (no hover state, no keyboard focus ring, no select callback).
- [x] 5.4 The metadata badge row uses small inline elements (suggest a local `<MetaBadge>` 1-liner with `inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono`). Target link uses `<Link>` with the `ArrowUpRight` icon (same as today).
- [x] 5.5 Action buttons (`Popup`, `Kill`) on the card MUST `e.stopPropagation()` in their onClick to avoid bubbling to the card's select handler. Kill keeps opening the existing confirm Dialog (current `setKillTarget` flow). Popup keeps calling `window.open(popupUrl(row), popupTarget(row), 'popup,width=1200,height=800')`.
- [x] 5.6 Apply the `hidden md:inline-flex` class to the Popup button so it's hidden below md, matching the existing pattern (and the unchanged spec scenario).

## 6. Right pane: terminal + empty state

- [x] 6.1 Implement `RightPane`: takes the currently-selected `row: TmuxSessionRow | null`. When null, renders a centered placeholder ("Select a session from the list" + brief hint). When non-null, renders the header bar + `<TerminalView>` keyed on `row.sessionName`.
- [x] 6.2 Header bar: full sessionName in monospace, `Pop out` button on the right (uses the same `popupUrl(row)` helper). Layout: `flex items-center justify-between border-b px-3 py-2`.
- [x] 6.3 TerminalView dispatch:
   - `row.matchable === true` AND `parsed.project / scope / slug / agent` all non-null → `<TerminalView mode="standard" project={p.project!} scope={p.scope!} slug={p.slug!} agent={p.agent!} key={row.sessionName} />`.
   - Else if `row.staleReason === null` (manual) → `<TerminalView mode="raw" sessionName={row.sessionName} key={row.sessionName} />`.
   - Stale rows never reach RightPane because they aren't selectable (assert this with a `console.warn` + render empty-state fallback if it ever happens).
- [x] 6.4 The wrapper around `<TerminalView>` is `<div className="flex flex-1 flex-col min-h-0">` so the iframe fills the pane and scrolls internally.

## 7. Selection state + URL sync

- [x] 7.1 Read the selected sessionName from `useSearchParams().get('session')` on mount. Decode URI-encoded value. Compute the selected `row` as `all.find((s) => s.sessionName === selected)`.
- [x] 7.2 Define `handleSelect(name: string)` that calls `router.replace(\`/manage/tmux?session=\${encodeURIComponent(name)}\`)` (or with no param if name is `null`). Use Next's `useRouter` from `next/navigation`.
- [x] 7.3 If `selected` is non-null but no matching row is in `all`, fire `router.replace('/manage/tmux')` once (use `useEffect` keyed on `[selected, all.length]`) and the right pane falls back to empty state.
- [x] 7.4 Wire the Kill mutation's `onSuccess` so that if the killed session was selected, it also clears the URL param (call `router.replace('/manage/tmux')`).

## 8. Drawer removal at /manage/tmux

- [x] 8.1 Remove the `import { useTerminalDrawer }` from `tmux-page.client.tsx`. Remove the `drawer = useTerminalDrawer()` line. Remove `handleOpenDrawer` entirely. Remove the `Sidebar` icon from `lucide-react` imports (was used only by the Drawer button).
- [x] 8.2 Verify `apps/web/components/providers.tsx` still mounts `<TerminalDrawerProvider>` (it should — other consumers like `<OpenWithButton>` still use it). DO NOT touch providers.tsx.
- [x] 8.3 Verify the existing `attach-tmux-by-name` change's tasks are still complete (it shipped the `openRaw` API plus the raw-mode `<TerminalView>`); this change does NOT touch that.

## 9. Test updates

- [x] 9.1 If `apps/web/app/manage/tmux/tmux-page.client.test.tsx` (or similar) exists, update its assertions: cards instead of rows, no Drawer button, badge presence rules, click-to-select. Otherwise create one if there's a reasonable home for it — defer to author judgment to avoid test creep. [No existing test; skipping creation per the "defer to avoid creep" clause]
- [x] 9.2 No backend tests change. `manager.test.ts` and `attach.route.test.ts` remain green. [Confirmed — full web suite 270/270 passes]

## 10. Verification

- [x] 10.1 `pnpm --filter @memon/web typecheck` passes.
- [x] 10.2 `pnpm --filter @memon/web test` passes.
- [x] 10.3 Rebuild prod via the CLAUDE.md restart sequence (kill PID → `pnpm --filter @memon/web build` → `pnpm start` → wait for port).
- [x] 10.4 Per CLAUDE.md verification protocol, read creds from `config.yml`, then:
   - `curl … /manage/tmux` → 200 ✓
   - `aria-orientation` + `resizable-panel` data-slot present in markup ✓ (the v4 react-resizable-panels emits ARIA + data-slot, not the literal `ResizablePanelGroup`/`data-panel-group-id` strings the task's grep expected — same evidence, different selector)
   - `Drawer</button` count = 0 ✓
   - Compiled CSS (minified prod) contains `--background`, `--foreground`, `--card`, `--muted`, `--primary`, `--accent`, `--border`, `--ring`, `--destructive`, `--sidebar` ✓ (the original `^  --token:` grep is for dev-mode formatting; prod CSS is single-line, used `grep -e "\-\-token:"` instead)
   - Category badges render: 13 `manual` (amber), 1 `exp` (sky) visible; 15 `Popup` + 15 `Kill` aria-labelled buttons (one per row).
- [x] 10.5 Browser smoke (described, not asserted via curl): **user-verified**:
   - Page loads with split-pane.
   - Dragging the divider resizes; refresh preserves the new sizes.
   - Resize the viewport below 768px → orientation flips to vertical.
   - Click a matchable row → terminal mounts in the right pane; URL shows `?session=<full-name>`.
   - Click a manual row → terminal mounts in raw mode; header shows full sessionName; Pop out opens `?sessionName=` URL.
   - Click stale row body → nothing happens; Kill button still works.
   - Kill the selected session → row disappears, right pane returns to empty state, URL clears.
   - Pop out from header opens a popup; right pane's terminal stays attached (manager dedup verifies both share the same ttyd port).
- [x] 10.6 Test mobile vertical layout once — Chrome DevTools "iPhone" viewport, hit /manage/tmux, confirm list is on top, terminal is on bottom, horizontal handle is draggable. **user-verified**.

## 11. Spec sync check

- [x] 11.1 `openspec validate tmux-manage-split-pane --type change` exits 0.
- [x] 11.2 No incidental changes to `openspec/specs/tmux-session-management/spec.md` (that file is only synced at archive time). [git status confirms no diff on canonical specs.]

## 12. Post-implementation feedback fixes (spec+code synced)

- [x] 12.1 **Scroll containment**: original implementation left the page able to grow taller than the viewport (only `min-h-svh` on `SidebarProvider`, no `overflow-hidden` cap). Added `className="h-svh overflow-hidden"` to `<SidebarProvider>` in `apps/web/app/manage/layout.tsx` and `className="min-h-0 overflow-hidden"` to `<SidebarInset>`, plus `overflow-hidden` on the inner wrapper. The list scroll inside `LeftPane` is now the only scrollable region; the page itself is fixed at `100svh`. No spec change needed (the spec already implies viewport containment via "page SHALL fill the available `<SidebarInset>` content area").
- [x] 12.2 **Default split ratios**: changed from `30/70` desktop and `45/55` mobile to **`33/67` (1:2) desktop** and **`50/50` (1:1) mobile** per user preference. Updated in `tmux-page.client.tsx` constants AND in the spec's two "Default split applies on first visit" scenarios AND in design.md D4 wording.
- [x] 12.3 **Stable client-side ordering**: the auto-refetch (every 5s) previously caused rows to jump around as `tmuxLastActivity` shifted them in the API's sort. Added an in-memory `orderedNames` snapshot that is re-snapshotted only when (a) a new sessionName appears or (b) the user clicks the manual `Refresh` button. Implemented in `tmux-page.client.tsx`; documented as new design decision **D11**; codified as a new ADDED requirement `Stable client-side ordering of the session list` with five scenarios in the spec delta.
