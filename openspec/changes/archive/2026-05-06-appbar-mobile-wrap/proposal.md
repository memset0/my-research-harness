## Why

On phone-width viewports, the AppBar's five tabs (`Experiments`,
`Hypotheses`, `Journal`, `Reports`, `Digests`) plus the
`SidebarTrigger` exceed the viewport width. The current header is a
fixed-height single-row flex container (`flex h-12 items-center`),
so the overflow widens the page and a horizontal scrollbar appears
on the entire body. The user wants:

1. The tabs SHALL wrap to a second row when they don't fit on one,
   making the header taller instead of widening the page.
2. The `SidebarTrigger` (drawer hamburger) SHALL stay vertically
   centered relative to the (potentially multi-row) tab block.

## What Changes

- The AppBar header SHALL drop its fixed height and use `min-h-12`
  with vertical padding so it can grow when the inner tab list wraps.
- The tab list (`<nav>`) SHALL use `flex-wrap` so tabs flow onto
  additional rows when the available width is exhausted. The list
  SHALL also receive `flex-1 min-w-0` so it occupies the remaining
  horizontal space and is allowed to shrink below its intrinsic
  width (the precondition for wrap).
- The `SidebarTrigger` SHALL keep its visibility scope (`md:hidden`)
  unchanged and SHALL remain vertically centered via the header's
  `items-center` (since the header now has `min-h-12`, not `h-12`,
  the trigger centers relative to whichever row count the nav
  produces).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `web-layout`: extend the existing `Top AppBar with view tab
  switcher` requirement with a new scenario covering narrow-viewport
  wrap + trigger centering.

## Impact

- `apps/web/components/app-bar.tsx` — three className edits: header,
  nav. No JS-logic change. No spec on tab routing changes.
- No new shadcn components installed; uses existing primitives.
