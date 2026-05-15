## Context

The dashboard CSS (`apps/web/app/globals.css`) already authors a complete dark palette inside a `.dark { ... }` block, and `@custom-variant dark (&:is(.dark *))` is declared (line 7). Every semantic token used today (`--background`, `--foreground`, `--card`, `--popover`, `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`, `--chart-*`, `--sidebar*`) has both a `:root` light value and a `.dark` value. The single missing piece is a runtime that adds the `dark` class to `<html>` when the user wants the dark scheme.

Today's `app/layout.tsx` renders `<html lang="en" className={cn("font-sans", inter.variable)}>`, and the sidebar header (`apps/web/components/app-sidebar.tsx:117-124`) is a single-cell `<SidebarHeader>` containing only the `memon` wordmark `Link`. The proposal places the toggle right-aligned in that header row.

Stakeholders: every user of the dashboard. Memory says runtime + skills changes ship separately ([[feedback_split_runtime_then_skills]]); this change is **runtime-only** — no agent-skill rewrites are bundled in.

## Goals / Non-Goals

**Goals:**
- Persist a per-user, per-browser theme preference (Light / Dark / System) across reloads via `localStorage`.
- Sync System mode with `prefers-color-scheme` and update live when the OS toggles.
- No flash-of-wrong-theme on page load (FOUC) — the chosen class is applied before first paint.
- A single segmented control with three slots (Light · Dark · System), one visibly-active slot, and an animated indicator that slides between slots on selection change.
- Layout: sidebar header is a single row, `flex items-center justify-between`; logo `Link` on the left, segmented control on the right.
- Keyboard accessible: arrow keys move focus between slots, Space/Enter activates, ARIA reports the current value.

**Non-Goals:**
- No per-project theme. Theme is global to the browser tab.
- No server-side theme persistence (not written to `config.yml`, not sent in cookies). Owner Basic / share-cookie auth is unaffected.
- No transition animations on theme switch beyond what `next-themes`' `disableTransitionOnChange` allows — token-level color transitions are intentionally disabled to avoid a global page-wide animation flash.
- No new color tokens. The existing `.dark` palette is the contract; if a future page introduces a new token, that page's change is responsible for adding both light and dark values.
- No "auto switch at sunset" or scheduled themes. Just three modes.

## Decisions

### D1. Use `next-themes` as the runtime, with `attribute="class"` and `defaultTheme="system"`

Tried alternatives:
- **Hand-rolled** — read `localStorage`, set `documentElement.classList` in an inline `<script>` to avoid FOUC. Works but reimplements four edge cases (system-pref listener, storage event sync across tabs, transition disable on change, SSR hydration guard) that `next-themes` solves out of the box.
- **`@radix-ui/themes`** — heavy, alters far more than the `dark` class.

`next-themes` is the canonical shadcn recipe (verified via `https://ui.shadcn.com/docs/dark-mode/next`). Recommended config:

```tsx
<ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
```

- `attribute="class"` matches what `@custom-variant dark (&:is(.dark *))` expects in `globals.css:7`.
- `defaultTheme="system"` honors the OS preference until the user picks an explicit value.
- `enableSystem` makes `theme === "system"` a first-class value (vs. just resolving to `light`/`dark`).
- `disableTransitionOnChange` injects a one-frame `* { transition: none !important; }` while flipping classes; this prevents every transitioned element on the page from animating its color in unison (which reads as a jarring whole-page flash).

### D2. Place `ThemeProvider` inside `<body>`, with `suppressHydrationWarning` on `<html>`

`next-themes` is a client component; it cannot render before `<html>` exists in the server tree. Placement:

```tsx
<html lang="en" suppressHydrationWarning className={cn("font-sans", inter.variable)}>
  <head>...</head>
  <body className="bg-background text-foreground antialiased">
    <NextTopLoader ... />
    <Providers session={session}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <ViewerBanner />
        <div className="min-h-screen">{children}</div>
        <Toaster ... />
      </ThemeProvider>
    </Providers>
  </body>
</html>
```

`suppressHydrationWarning` is required only on `<html>` because the `class` and `style` set by `next-themes`' inline pre-paint script on the **client** differ from the server-rendered ones. React would otherwise log a hydration warning every page load.

`ThemeProvider` is nested inside the existing `<Providers>` (which currently mounts `QueryClient`, `SessionContext`, etc.) rather than wrapping it. Reason: `ThemeProvider` doesn't depend on any of `<Providers>`'s context, but consumers of `useTheme()` will frequently be inside `<Providers>` (e.g., dialogs that also need `useQueryClient()`), so keeping `ThemeProvider` innermost is the standard pattern.

### D3. Build `ThemeToggle` as a thin wrapper over shadcn `ToggleGroup`, NOT a fork

Per repo rule F3, `components/ui/toggle-group.tsx` is owned by the shadcn CLI and must not be edited. The animated sliding indicator is **not** a part of shadcn's primitive — `ToggleGroup` ships as three plain `Toggle` buttons. We get the indicator by composing on top:

```
ThemeToggle
├── relative container (sets the indicator's positioning context)
├── absolute "indicator" div with bg-background + shadow, translated via CSS transform based on the active value
└── ToggleGroup type="single" value=... onValueChange=...
    ├── ToggleGroupItem value="light"  → <SunIcon />
    ├── ToggleGroupItem value="dark"   → <MoonIcon />
    └── ToggleGroupItem value="system" → <LaptopIcon />
```

The indicator is a separate sibling `div`, NOT injected via Tailwind's `data-[state=on]` selectors on the items themselves. Reason: when only the active item carries a background, the active→inactive→active transition has a hard cut. A separate translated indicator gives the visual "slide" the user asked for.

Indicator math: each slot is `w-7` (1.75rem). Indicator is `w-7`, positioned `left-1` (matches the wrapper's `p-1`). Translate by index × `100%` (i.e. one slot width). Tailwind: `transition-transform duration-200 ease-out`, with `style={{ transform: \`translateX(\${index * 100}%)\` }}` since arbitrary `translate-x-[N%]` runtime values can't be statically extracted by Tailwind v4.

The container has `role="presentation"`; `ToggleGroup` itself supplies `role="group"` with proper a11y from Radix.

Icon source: `@hugeicons/react` (already in deps) — pick three icons (`Sun03Icon`, `Moon02Icon`, `Computer01Icon` or the nearest equivalent at apply time). Sized at 16px to fit `w-7 h-7` slots with adequate padding.

### D4. Hydration-safe rendering of the toggle

`next-themes`' `useTheme()` returns `undefined` on the server and during the first client render until `mounted`. If we render the toggle's `aria-pressed` / indicator position based on the resolved theme immediately, server-rendered HTML and the first client render disagree → hydration warning.

Pattern (from shadcn's docs):

```tsx
const { theme, setTheme } = useTheme()
const [mounted, setMounted] = useState(false)
useEffect(() => setMounted(true), [])
if (!mounted) {
  return (
    <div
      data-theme-toggle
      data-mounted="false"
      className="h-8 w-[5.5rem]"
      aria-hidden
    />
  )
}
```

The placeholder reserves the **exact** width/height of the mounted toggle so the sidebar header layout doesn't reflow when the toggle mounts. Width breakdown: container `p-0.5` (0.125rem × 2) + 3 slots × `w-7` (1.75rem) = `5.5rem`; height `h-8` matches the container's outer height in the mounted state.

The `data-theme-toggle` attribute is on **both** the placeholder and the mounted state, with `data-mounted` flagging which one is rendered. This lets server-side HTML verification (curl + grep) confirm the slot is reserved without depending on post-hydration markup.

### D5. Sidebar header refactor — `flex items-center justify-between`

Current:
```tsx
<SidebarHeader className="px-3 py-2">
  <Link href="/" className="font-mono ...">memon</Link>
</SidebarHeader>
```

New:
```tsx
<SidebarHeader className="flex flex-row items-center justify-between px-3 py-2">
  <Link href="/" className="font-mono ...">memon</Link>
  <ThemeToggle />
</SidebarHeader>
```

`SidebarHeader` is a flex container by default in shadcn's primitive but **column-direction**; we override to `flex-row` so logo and toggle sit on the same line. Verified by reading `components/ui/sidebar.tsx` at apply time before editing — if the override needs a different selector (e.g., `[&_>div]:flex-row`), apply that instead.

When the sidebar is collapsed to its icon-only state, the header still renders. The toggle gets `data-[state=collapsed]:hidden` (or equivalent via the sidebar context hook) so collapsed sidebars don't show a half-clipped segmented control. Active during apply: decide between hiding entirely vs. collapsing the toggle to a single icon-button DropdownMenu — the simpler option (hide) is the default; only switch to DropdownMenu if the user requests it.

### D6. Tests

One new test file: `apps/web/components/theme-toggle.test.tsx`.

```ts
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from './theme-provider'
import { ThemeToggle } from './theme-toggle'

it('renders three options with accessible labels', () => {
  render(<ThemeProvider attribute="class" defaultTheme="system" enableSystem><ThemeToggle /></ThemeProvider>)
  expect(screen.getByRole('radio', { name: /light/i })).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: /dark/i })).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: /system/i })).toBeInTheDocument()
})

it('reports the System slot as active by default', async () => {
  render(<ThemeProvider attribute="class" defaultTheme="system" enableSystem><ThemeToggle /></ThemeProvider>)
  // jsdom flushes effects; force one tick if needed
  await new Promise((r) => setTimeout(r, 0))
  expect(screen.getByRole('radio', { name: /system/i })).toHaveAttribute('aria-checked', 'true')
})
```

`ToggleGroup` with `type="single"` renders items with `role="radio"` (Radix), which is why the test queries radios — not buttons. Both assertions run inside a `ThemeProvider`; without it, `useTheme()` returns `undefined` and the placeholder branch never advances.

No need to mock `localStorage` — jsdom supplies one. No need to mock `matchMedia` either; `next-themes` guards on its presence.

### D7. Verification (per repo rule F1, F4)

After apply, four manual checks before declaring done:

1. `pnpm --filter @memon/web typecheck` — must pass.
2. Fetch a page and grep for the toggle's markup. The toggle uses a `mounted` gate, so the server-rendered HTML only contains the **placeholder** (`<div data-theme-toggle data-mounted="false" aria-hidden>`); the `role="radiogroup"` and `aria-label="Light|Dark|System"` markup only appears after client hydration. So check:
   ```bash
   curl -sSL -u "$MEMON_USER:$MEMON_PASS" http://localhost:3737/ \
     | grep -cE 'data-theme-toggle data-mounted="false"'
   # expect: 1 (the placeholder is in the static HTML)
   curl -sSL -u "$MEMON_USER:$MEMON_PASS" http://localhost:3737/ \
     | grep -oE '<script>[^<]*localStorage[^<]*</script>' | head -c 80
   # expect: a fragment of the next-themes inline pre-paint script
   ```
   The presence of both the placeholder AND the next-themes inline script is the curl-visible contract; the radiogroup + aria-labels are verified via the test suite (which runs the component in jsdom and confirms post-mount markup).
3. Fetch the compiled CSS and confirm both light and dark token sets ship:
   ```bash
   curl -sS "http://localhost:3737/_next/static/css/app/layout.css?v=$(date +%s)" | grep -cE "^  --background:"
   # expect 2 (one in :root, one in .dark)
   ```
4. Browser sanity: open Dashboard, click each of the three slots, confirm:
   - Light → light tokens; `<html>` has no `dark` class
   - Dark → dark tokens; `<html class="dark">`
   - System → tracks OS preference, `<html>` toggles `dark` on OS change
   No flash, no console warnings.

## Risks / Trade-offs

- **[Risk] FOUC on initial paint** → Mitigation: `next-themes` injects a synchronous inline script in `<head>` that reads `localStorage` and sets the class before React hydrates. Confirmed by inspecting `_next/static/.../page.html` for the inline script.
- **[Risk] Hydration warning if `suppressHydrationWarning` is on the wrong tag** → Mitigation: place it only on `<html>` (not on `<body>` or descendants). Tested in D6's render path.
- **[Risk] Token gaps in the dark palette discovered later** → Mitigation: the entire token set is already authored. If a future page introduces a token (e.g., a new `--chart-6`), the convention is documented in CLAUDE.md F4 — that change owns its dark value. This change does not need to backfill anything.
- **[Risk] Test flake on `aria-checked` before `mounted` flips** → Mitigation: await a tick in the test, as shown in D6. Already handled.
- **[Risk] Sidebar in offcanvas (mobile) mode hides the toggle entirely** → Mitigation: the toggle is still inside `SidebarHeader`, which renders inside the off-canvas sheet on mobile. The user can open the drawer to access the toggle. If we want it pinned to the AppBar on mobile, that's a follow-up; not in scope for this change (per the user's specific layout request, the toggle belongs in the sidebar header).
- **[Trade-off] Viewer share users can change theme** → Accepted: theme is a pure client preference, not authority-bearing. No reason to restrict it.

## Migration Plan

Single-version rollout — no flag, no phased deploy. Theme defaults to `system`, which matches every user's current implicit behavior (OS preference is dark for many) only when their OS is set to dark; otherwise the UI is visually identical to today. Rollback = revert the commit; localStorage entries left over from the brief deployment are inert (they're just unread strings).

## Open Questions

1. **Should the toggle also live on the unauthenticated `/login` page?** Default position: yes, but only if `app/login/page.tsx` already wraps in the same layout. Decided at apply by inspection; if it requires a parallel mount, defer to a follow-up.
2. **Should we add a `dark:` style audit step?** Defer. The existing `.dark` palette is the contract; any single-element styling that breaks under dark mode is fixed page-by-page in follow-ups when discovered.
