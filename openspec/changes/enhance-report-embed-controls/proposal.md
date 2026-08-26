## Why

Embedded Report HTML can change while a Report remains open, but the current toolbar has no explicit reload action or inexpensive way to tell the reader that the served entry changed. Its Fullscreen action enters the browser Fullscreen API instead of providing an in-page focused view, and the growing toolbar consumes too much mobile space. Multiple lazy iframes also start their load timeout before they approach the viewport, so later plots can be incorrectly removed before the browser begins loading them.

## What Changes

- Add an explicit Reload action that re-probes and remounts the selected iframe without changing its canonical new-tab URL.
- Add low-frequency, header-only resource revision checks and show a small semantic update indicator when the served HTML entry changes.
- Replace browser-native fullscreen with a page-internal expanded view that covers the application header/sidebar and also works when the Report originates in a drawer or right split.
- Collapse every iframe action into a compact three-dot menu on mobile while keeping the title visible; retain direct toolbar controls on larger screens.
- Start the bounded iframe load timeout only once a lazy embed approaches the viewport so later plots are not failed before their navigation begins.
- Add lightweight resource version headers and an authenticated `HEAD` path to the existing Report asset route.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-dashboard`: define reload/update detection, in-page expanded mode, responsive toolbar actions, and viewport-aware lazy iframe loading.

## Impact

- `apps/web/components/report-html-embed.tsx`: lifecycle, polling, update indicator, expanded presentation, and mobile action menu.
- `apps/web/app/api/report-assets/[project]/[id]/[...path]/route.ts` and Report resource metadata: header-only revision responses.
- Auth classification plus component/route regressions for `HEAD`, reload, polling, mobile controls, expanded mode, and multiple lazy embeds.
- No Report format, manifest, trust boundary, storage schema, or automatic content reload is introduced.
