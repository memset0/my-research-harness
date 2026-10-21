## Why

Expanding the HTML view of a Report or Wiki bundle page is lost on reload, and an expanded view cannot be linked. The owner wants the expanded state in the URL so that refreshing the page keeps it expanded.

## What Changes

- On full Report and full Wiki bundle pages, activating Expand adds `expanded=1` to the URL query (replacing the history entry, without scrolling or navigating) and exiting removes it; a page loaded with `expanded=1` opens expanded.
- Other query parameters are preserved. Side panes and HTML embedded inside Markdown keep their local, unlinked expanded state.

## Capabilities

### New Capabilities

### Modified Capabilities
- `web-dashboard`: the expanded HTML view of a full bundle page is reflected in and restored from the URL.

## Impact

`apps/web/components/report-html-embed.tsx`, `content-presentation.tsx`, the Report and Wiki page panes and their tests. Central-only: PATCH release.
