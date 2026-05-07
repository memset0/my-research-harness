## Why

Tags (`#foo`, `#bar`, …) on the v3 exp surfaces currently render at
`text-xs` (~12px), which makes them visually compete with monospace
labels and section headers nearby. The user wants tags one size
smaller — close to the dashboard's small mono font (`text-[10px]` /
`text-[11px]`) — so they read as compact metadata rather than primary
labels.

The run-panel frontmatter card already uses `text-[10px]` for tag
Badges (set during the bug-3 run-panel rich port). This change brings
the other two tag-rendering sites — the exp detail page header and
the exp card grid footer — into the same scale, removing the
inconsistency.

## What Changes

- The tag Badges in `experiment-page.tsx`'s page header SHALL render
  at `text-[10px]` (currently `text-xs`).
- The tag Badges in `experiment-card-grid.tsx`'s card footer SHALL
  render at `text-[10px]` (currently `text-xs`).
- No structural / layout changes — only the Badge `className`'s text
  size token changes.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
<!-- This is purely a typography polish, NOT a behavior change. The
relevant existing requirement on the v3 exp views doesn't pin the
exact tag font size today; tightening it now would over-specify a
trivial style choice. So no spec delta is required.
However, openspec validate requires at least one delta, so we ADD
a small "Tag typography" requirement to web-dashboard pinning this
choice. -->
- `web-dashboard`: add a "Tag typography" requirement so the size
  doesn't drift back to `text-xs`.

## Impact

- `apps/web/components/experiment-page.tsx` — one className edit on
  the header tag Badge.
- `apps/web/components/experiment-card-grid.tsx` — one className edit
  on the footer tag Badge.
- No backend, no API, no data shape change.
