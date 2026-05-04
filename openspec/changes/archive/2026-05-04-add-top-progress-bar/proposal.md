## Why

Clicking a sidebar / AppBar / experiment-row link does an App-Router **soft navigation** — no full page reload, but server roundtrip + RSC stream + hydration can still take 0.5–2 s. During that window nothing on screen changes at all, so users repeatedly wonder "did my click register?" and re-click. We need an immediate, low-cost visual confirmation that the soft navigation is in flight.

## What Changes

- Add a thin (≈2 px) top-of-viewport **progress bar** that becomes visible whenever the App Router is mid-navigation, in the well-known `nprogress` style:
  - Filled portion uses the project's `--primary` theme color.
  - Unfilled portion is fully transparent — only the moving filled segment is visible against the page chrome.
  - Animation is **indeterminate** (no real progress): grows fast at first, decelerates toward ~90 %, then snaps to 100 % and fades when the new route commits.
- Use the third-party `nextjs-toploader` library for the bar itself (it already intercepts `<Link>` clicks, `router.push` / `router.replace`, and back/forward, then completes when the App Router commits the new segment — i.e. exactly the soft-nav window users currently sit through with no feedback).
- Mount it once globally in `apps/web/app/layout.tsx`, alongside the existing `<Toaster />`.
- Bind the bar's color to the live `--primary` token via a CSS override in `globals.css`, so light/dark mode and any theme changes propagate automatically.

## Capabilities

### New Capabilities
(none — this is a UX refinement of the existing dashboard layout)

### Modified Capabilities
- `web-layout`: gains a new requirement covering the global top navigation progress bar — its position, color, trigger conditions, and lifecycle.

## Impact

- **New runtime dependency**: `nextjs-toploader` (added to `apps/web/package.json`). It is a small (~10 KB minified), App-Router-native, single-purpose library; bundle impact is negligible.
- **Modified file**: `apps/web/app/layout.tsx` — one mount of `<NextTopLoader … />` next to `<Toaster />`.
- **Modified file**: `apps/web/app/globals.css` — a small override that maps the bar's filled color and shadow to `var(--primary)`.
- **No backend / API changes**.
- **No breaking changes**: purely additive visual layer with `pointer-events: none`; cannot interfere with existing UI.
