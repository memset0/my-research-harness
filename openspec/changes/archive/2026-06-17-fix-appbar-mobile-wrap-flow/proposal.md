## Why

On narrow (mobile) viewports the top **AppBar** wraps badly. The left-side
view tabs (`Experiments … Code review`) live in their own `flex-1
flex-wrap` `<nav>` box, while the right-side controls (`ManageSharesDialog`,
`OpenWithButton`) are siblings *outside* that box. When the tabs wrap to
multiple rows, the right controls stay pinned to the right of the whole
multi-row tab block and vertically centered against it — producing a ragged,
lopsided layout instead of one clean flowing row set.

Separately, the `Code review` tab label is mis-cased: every other tab is
title-cased (`Experiments`, `Hypotheses`, …) but this one reads `Code
review` (lower-case `r`). It should be `Code Review`.

## What Changes

- **Fixed drawer button.** The `SidebarTrigger` (drawer open/close button)
  stays a fixed leading control pinned at the left of the header — it does
  NOT join the wrap flow and never reflows with the tabs/controls.
- **Shared wrap flow.** The six view tabs and the right-side controls share
  **one** `flex-wrap` container — an inner wrapper to the right of the
  trigger that takes the row's remaining width. The tabs fill from the left;
  the right-side controls flow *after* them in the same wrap context instead
  of sitting in a detached box. The `<nav role="tablist">` semantic wrapper
  is preserved via `display: contents` so its children join the inner flex
  flow without losing the tablist grouping.
- **Per-line left/right alignment.** The right-side control group carries
  `ml-auto` so that, on whatever flex line it lands, left-aligned items hug
  the left and the right group hugs the right edge — including the final
  shared line where the last tab(s) and the right controls coexist.
- **Label fix.** The AppBar tab label `Code review` → `Code Review`.

Out of scope (explicitly not touched): the browser-tab `<title>` metadata
strings and page `<h1>` headings that read `Code review` / `Code reviews`
(`code-review-list.tsx`, `experiment-code-reviews.tsx`,
`code-review-detail.tsx`, the route `page.tsx` metadata). Only the AppBar
nav tab label changes.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `web-layout`: the "Top AppBar with view tab switcher" requirement gains a
  responsive-wrapping behavior (single shared wrap flow + per-line
  left/right alignment) and the `Code review` tab label is corrected to
  `Code Review`.

## Impact

- `apps/web/components/app-bar.tsx` — the only runtime file changed: keep the
  `SidebarTrigger` as a fixed left sibling, move the tabs + right controls
  into an inner `flex-1 flex-wrap` wrapper (`<nav>` → `contents`, right
  controls wrapped in an `ml-auto` group), and fix the tab label.
- No API, data-model, or dependency changes. No new components.
- Visual-only change on desktop (single-line layout is unchanged); behavior
  change is confined to wrapping on narrow viewports.
