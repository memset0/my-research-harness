## Context

Next.js App Router soft navigations (`<Link>` clicks, `router.push`, browser back/forward) include a server roundtrip (RSC stream of the new segment) and any RSC-time data fetches. On a slow link or slow API the gap between click and visible page swap can hit 0.5–2 s with **no UI change at all** — that's the actual reported problem. `loading.tsx` only fires for nested route segments and is not mounted for cross-route transitions, so today there is no global feedback.

The dashboard is Next.js 15.5 + React 19 + Tailwind v4 + shadcn. It already mounts a global `<Toaster />` (sonner) in `app/layout.tsx`, so adding one more global UX layer there is idiomatic.

## Goals / Non-Goals

**Goals:**
- Immediate (<50 ms) visual confirmation that an App-Router soft navigation is in flight.
- Cover all in-app soft-nav paths: `<Link>` clicks, programmatic `router.push` / `router.replace`, browser back/forward.
- Theme-honoring: filled portion tracks `--primary`, even after light/dark or theme switches.
- Self-completes when the App Router commits the new segment.
- Zero hand-rolled click-interception or completion-detection logic in our code — that work is delegated to a library that already does it well.

**Non-Goals:**
- Real progress measurement.
- Showing on hash-only or query-only same-page transitions where there is no fetch.
- Reusable, third-party-quality progress-bar component — this is a single internal layout primitive.
- Spinner / peg / per-link progress — only the bar is in scope.

## Decisions

### Decision 1 — Use `nextjs-toploader`

**Choice:** Install `nextjs-toploader` and mount `<NextTopLoader />` once in the root layout.

**Rationale:**
- It is the most popular App-Router-native progress-bar library (~3M weekly downloads, regular Next-version updates), purpose-built for exactly this problem.
- It already patches the App Router internals: it observes the **commit** of a new RSC segment, not just `<a>` clicks, so it covers `router.push` / `router.replace` / back-forward / `<Link>` uniformly. That is the hard part of doing this correctly and it is the entire reason we are not DIY-ing it.
- ~10 KB minified, a small one-purpose library — negligible cost relative to the ergonomic and correctness wins.
- API is one component with ~10 props; rollback = delete one import + one CSS block.

**Alternatives considered:**
- *DIY* (~80 LOC custom component) — rejected. Detecting "the new segment has actually committed" is non-trivial; `usePathname()` + `useSearchParams()` change detection is close but misses programmatic navigations to the same route, and any home-grown solution will accrue edge cases.
- *`next-nprogress-bar`* — wraps the original `nprogress`. More configurable but bigger; we don't need the extra knobs.
- *`@bprogress/next`* — newer fork of `next-nprogress-bar` with a modernized API. Promising, but smaller user base than `nextjs-toploader`. Would consider if `nextjs-toploader` falls behind a future Next major.

### Decision 2 — Theme color via CSS override, not the `color` prop

**Choice:** Pass benign defaults to `<NextTopLoader />` (or omit `color` and let it default), and put a small CSS override in `apps/web/app/globals.css`:

```css
/* Override nextjs-toploader bar color to track the --primary token. */
#nprogress .bar { background: var(--primary) !important; }
#nprogress .peg { display: none; }
```

**Rationale:**
- The library accepts a `color` string but historically embeds it into multiple inline styles (background + box-shadow); CSS variables sometimes don't survive that interpolation cleanly across versions. A CSS override is dead simple and impossible to break.
- Override binds to the live `--primary` token, so dark mode and theme changes propagate automatically without re-mount.
- Hiding `.peg` (the leading glow) keeps the visual minimal, matching the user's "filled = primary, unfilled = transparent" ask.

### Decision 3 — `<NextTopLoader />` configuration

```tsx
<NextTopLoader
  height={2}
  showSpinner={false}
  shadow={false}
  crawlSpeed={200}
  speed={200}
  zIndex={1600}
/>
```

- `height={2}` — 2 px bar (match user's "顶上一根条" ask).
- `showSpinner={false}` — no top-right spinner; just the bar.
- `shadow={false}` — no glow; pairs with the `peg: display none` override.
- `crawlSpeed={200}` / `speed={200}` — library defaults that produce a snappy nprogress-style crawl.
- `zIndex={1600}` — library default; sits above the AppBar (which is in the low hundreds) and just below sonner toasts.

### Decision 4 — Mount at root layout, alongside `<Toaster />`

`<NextTopLoader />` is a self-contained client component that owns its own portal-style DOM and state. No provider, no context, no `useTransition` callsite. One mount covers the entire app.

## Risks / Trade-offs

- **Risk: Library color prop ignores `var(--primary)`.** → Mitigation: skip the prop, override via CSS (Decision 2). This is the *expected* path, not a fallback.
- **Risk: Library version drifts behind a future Next major.** → Mitigation: small surface area (one component + one CSS block); migration to `@bprogress/next` or DIY is mechanical if needed.
- **Risk: Library's `#nprogress` global ID collides with something else on the page.** → Mitigation: project-wide grep before merging confirms no other `#nprogress` exists. (None expected — we don't ship `nprogress` directly.)
- **Trade-off: One new runtime dependency.** Counter to the project's "lean on shadcn / minimal deps" leaning, but justified by Decision 1 — DIY would carry ongoing maintenance cost on Next-internal behavior we don't want to track.
- **Trade-off: No hard timeout knob in our code.** The library's own behavior is to complete the bar when the next router commit fires. A truly stuck navigation would visually stall at ~90 % until the user navigates again. Acceptable v1 — the existing error boundary already renders an error UI for actual failures.

## Migration Plan

Purely additive. Deploy = `pnpm install` + ship a build with the new `<NextTopLoader />` mount + CSS override. Rollback = revert that one import, that one mount, and the CSS block; remove the dependency on the next housekeeping pass.
