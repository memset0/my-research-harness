## Why

The Report detail page currently presents the rendered document directly on
the application's tinted page background, so the reading surface does not feel
like a distinct document. Its desktop Report picker is also permanently visible
and renders as a dense stack of divider rows, making the page harder to focus
and scan than other polished management surfaces in the dashboard.

## What Changes

- Give the rendered Report body a theme-aware card background so it reads as a
  white document surface in light mode while retaining the corresponding dark
  theme treatment.
- Let desktop users show or hide the left Report picker, with an accessible
  control that remains available in both states and returns the content pane to
  the reclaimed width when hidden.
- Restyle each Report picker entry as a compact selectable card, following the
  tmux management page's spacing, border, hover, focus, and active-state rhythm
  with shadcn semantic tokens and interaction conventions.
- Render canonical Report frontmatter `created_at` and `updated_at` values as
  human-readable local date-times while retaining the source ISO timestamp as
  secondary hover information and falling back safely for invalid values.
- Preserve the existing mobile Report-list Sheet and leave Digest routes
  unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `inbox-viewer`: define the Report-only document background, collapsible
  desktop picker, card-style Report selection behavior, and human-readable
  canonical frontmatter timestamps.

## Impact

- `apps/web/components/inbox-shell.tsx`: Report-specific reading surface,
  desktop picker visibility state and trigger placement, and picker item
  presentation.
- `apps/web/components/frontmatter-panel.tsx` and the existing local timestamp
  presenter: key-aware Report timestamp formatting for both YAML strings and
  parsed date values.
- Inbox component tests: Report/Digest separation, accessible toggle behavior,
  reclaimed layout width, card states, semantic background tokens, and
  frontmatter timestamp formatting/fallbacks.
- No data format, Report API, routing, mobile drawer, dependency, or migration
  changes.
