## Why

A Report or Wiki page with the `service` presentation shows its live application in a fixed-height iframe with no toolbar, so it cannot be expanded the way an HTML bundle page can.

## What Changes

- The live application iframe uses the shared embed toolbar (zoom, Reload, Open in new tab, Expand, mobile overflow menu), with the same page-internal expanded view as HTML bundles.
- On full Report and Wiki pages the expanded state is kept in `expanded=1`, as for HTML bundles; side panes keep it locally.
- The live embed loads the application directly: no HTML probe and no revision polling, since the service availability check already gates it.
- Availability badge, Check again, Open application and the offline guidance are unchanged.

## Capabilities

### New Capabilities

### Modified Capabilities
- `content-bundles`: the live service view offers the shared embed toolbar and Expand.

## Impact

`apps/web/components/report-html-embed.tsx`, `content-presentation.tsx` and their tests. Central-only: PATCH release.
