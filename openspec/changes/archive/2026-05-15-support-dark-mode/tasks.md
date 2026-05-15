## 1. Dependencies and primitives

- [x] 1.1 Add `next-themes` to `apps/web/package.json` (`pnpm --filter @memon/web add next-themes`).
- [x] 1.2 Install the shadcn `toggle-group` primitive non-interactively: `pnpm dlx shadcn@latest add toggle-group --yes` from `apps/web/`. Verify it generated both `apps/web/components/ui/toggle-group.tsx` and `apps/web/components/ui/toggle.tsx`. Do NOT hand-edit either file.

## 2. Theme runtime

- [x] 2.1 Create `apps/web/components/theme-provider.tsx`: a `"use client"` module exporting `ThemeProvider` that simply forwards props to `NextThemesProvider`. Pure pass-through.
- [x] 2.2 In `apps/web/app/layout.tsx`, add `suppressHydrationWarning` to the `<html>` element.
- [x] 2.3 Mount `<ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>` immediately inside `<Providers>` (so the order from the outside in is `<Providers>` → `<ThemeProvider>` → existing children). Confirm `ViewerBanner`, `<div className="min-h-screen">{children}</div>`, and `<Toaster />` remain inside.

## 3. Theme toggle UI

- [x] 3.1 Create `apps/web/components/theme-toggle.tsx`: a `"use client"` component that
  - calls `useTheme()` from `next-themes`,
  - uses a `mounted` state to gate first render and emits a sized placeholder until mounted (per design D4); the placeholder carries `data-theme-toggle data-mounted="false"` so server-rendered HTML verification can find it,
  - renders a relative wrapper with three icons (`lucide-react`: `Sun`, `Moon`, `Monitor` — `lucide-react` is the project's existing icon library per `components.json` and existing imports in `viewer-banner.tsx` / `archive-toggle.tsx`; `@hugeicons/react` is installed but unused in `apps/web/`),
  - renders an absolutely-positioned indicator that translates via `style={{ transform: \`translateX(\${index * 100}%)\` }}`,
  - composes shadcn `ToggleGroup type="single"` with three `ToggleGroupItem`s (values `light`, `dark`, `system`),
  - sets `aria-label` on each item (Light / Dark / System).
- [x] 3.2 Do NOT edit `components/ui/toggle-group.tsx` or `components/ui/toggle.tsx`. Any styling that differs from the shadcn defaults is applied via `className={cn(...)}` on the wrapper or via overrides passed through `ToggleGroupItem`'s `className` prop.

## 4. Sidebar header layout

- [x] 4.1 In `apps/web/components/app-sidebar.tsx` (around line 117), change `<SidebarHeader className="px-3 py-2">` to `<SidebarHeader className="flex flex-row items-center justify-between px-3 py-2">`. Confirmed via inspection of `components/ui/sidebar.tsx:334-343` that `SidebarHeader` defaults to `flex flex-col gap-2 p-2`, and `cn()` + tailwind-merge resolve the flex-direction conflict in favor of the override.
- [x] 4.2 Add `<ThemeToggle />` as the second child of the header, after the existing `Link`. Imports go at the top of the file.
- [x] 4.3 Sidebar uses shadcn's default `collapsible="offcanvas"` — when collapsed, the entire sidebar (including header) is hidden via translate-off-screen, so no half-clipped toggle is possible. No additional gating needed. (Verified: `components/ui/sidebar.tsx` shows the offcanvas collapse hides the sidebar wholesale.)

## 5. Tests

- [x] 5.1 Create `apps/web/components/theme-toggle.test.tsx`. Render the toggle wrapped in `<ThemeProvider attribute="class" defaultTheme="system" enableSystem>` and assert:
  - three `radio`-role items exist with accessible names matching `/light/i`, `/dark/i`, `/system/i`,
  - after the mount effect flushes, the System slot has `aria-checked="true"` (Light and Dark have `aria-checked="false"`).
- [x] 5.2 Run `pnpm exec vitest run components/theme-toggle.test.tsx` — 2 tests pass.

## 6. Typecheck

- [x] 6.1 Run `pnpm --filter @memon/web typecheck` — zero errors.

## 7. Manual UI verification (per CLAUDE.md F1, F4)

- [x] 7.1 Killed PID 172450 on port 3737, cleaned `.next/`, rebuilt `@memon/web` (`next build` succeeds), restarted `pnpm start` (now PID 252496 on port 3737).
- [x] 7.2 Verified via `curl -sSL -u "$MEMON_USER:$MEMON_PASS" http://localhost:3737/` (redirects to `/p/project-a`):
  - `data-theme-toggle="true" data-mounted="false"` appears exactly **1** time → placeholder slot is reserved in static HTML.
  - The next-themes pre-paint inline `<script>` containing `localStorage` is present (≈545 bytes). It reads the persisted preference and sets `class="dark"` on `<html>` BEFORE React hydrates, so there is no FOUC.
  - The new sidebar header has `class="gap-2 p-2 flex flex-row items-center justify-between px-3 py-2"` → row layout took effect.
- [x] 7.3 Verified `/_next/static/css/e3e42255b85d0180.css` contains both light and dark token blocks (minified Tailwind v4 collapses whitespace, so the original grep `^  --background:` returned 0 — re-grepped as `--background:[^;]+;` per line and found `:root{...; --background:oklch(97.2% .003 230); --foreground:oklch(14.8% .004 228.8)}.dark{--background:oklch(14.8% .004 228.8); --foreground:oklch(98.7% .002 197.1); --card:oklch(21.8% .008 223.9); --sidebar:oklch(21.8% .008 223.9); ...}`). All five tokens checked (`--background`, `--foreground`, `--card`, `--sidebar`, `--primary`) appear in both blocks.
- [ ] 7.4 **Browser-only — defer to user.** Curl cannot drive `click()` on the toggle. Cannot verify in this session: the visible click-cycle of Light/Dark/System, the live `prefers-color-scheme` flip in System mode, and the absence of console warnings. Per CLAUDE.md F1's two-curl bar (HTML markup + CSS tokens) — both pass.
- [x] 7.5 Toggle sits inside `SidebarHeader`, which is inside `<Sidebar>` whose default `collapsible="offcanvas"` hides the entire sidebar wholesale when collapsed (translate-x off-screen). No half-clipped artifact is possible by construction. No additional gating needed.

## 8. Cross-page sanity

- [x] 8.1 Heuristic grep for literal-color Tailwind classes that don't theme-flip (`bg|text|border-(white|black|gray-\d+|slate-\d+|zinc-\d+|neutral-\d+)`) ran against `apps/web/**`. **No new violations introduced by this change.** See "Pre-existing dark-mode contrast follow-ups" below for the pre-existing list — out of scope per the no-widening rule.
- [x] 8.2 Spot-check terminal areas: `terminal-view.tsx`, `terminal-sheet.tsx`, `log-viewer.tsx`, `terminal-popup/page.tsx`, `terminal-popup-client.tsx` all use `bg-zinc-950 text-zinc-100/200/300` — these are **intentional** terminal-style dark surfaces, mode-invariant by design (terminals are conventionally dark in both light and dark UIs). Not a regression and not a follow-up.

## Pre-existing dark-mode contrast follow-ups (out of scope)

Surfaced during the 8.1 sweep. None of these are touched by this change; they should each get their own openspec change when prioritized:

- `apps/web/components/manage-shares-dialog.tsx:177` — `<Button variant="outline" size="sm" className="bg-white hover:bg-white/90">`. The "Copy" button next to a share URL hardcodes a white background; in dark mode it will be a white pill on a dark surface (visually wrong but not broken).
- `apps/web/components/readme-editor.tsx:417` — Monaco wrapper `<div className="... bg-white">`. Monaco itself follows its own theme; the wrapper background should track `bg-background` or `bg-card` so the editor frame matches the surrounding panel in dark mode.

Both are pure visual fixes — swap the literal class for the semantic equivalent (`bg-background` / `bg-secondary` / etc.). Each could be a one-line patch in a dedicated change.
