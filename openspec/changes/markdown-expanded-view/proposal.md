## Why

HTML Report and Wiki bundle pages can be expanded into a focused full-window view (kept in the URL), but Markdown Reports and Wiki pages cannot. The owner wants the same expand and collapse browsing for Markdown pages.

## What Changes

- Full Markdown Report and Wiki pages get an Expand action in their toolbar. Expanded, the page pane (toolbar, document and outline) covers the whole application window above headers and sidebars, background scrolling is locked, and the action becomes "Exit expanded view"; Escape also exits.
- The state uses the same `expanded=1` URL parameter as HTML bundle pages, so a reload keeps it. HTML and service pages keep their embed's own Expand.

## Capabilities

### New Capabilities

### Modified Capabilities
- `web-dashboard`: Markdown Report and Wiki pages offer a URL-backed expanded reading view.

## Impact

`apps/web/components` (shared expanded-view helpers, report and wiki page panes, content presentation) and tests. Central-only: PATCH release.
