## ADDED Requirements

### Requirement: AppBar tabs and right controls share one responsive wrap flow

The top **AppBar** SHALL keep the `SidebarTrigger` (drawer open/close button)
as a **fixed leading control** pinned at the left of the header, vertically
centered, that does NOT participate in any wrap flow. The view tabs and the
right-side controls (share dialog + open-with) SHALL instead share a **single
horizontal `flex-wrap` container** — an inner wrapper that sits to the right
of the trigger and takes the row's remaining width (`flex-1` + `min-w-0`) —
so that the tabs and the right controls participate in one shared wrapping
flow rather than the tabs wrapping inside a detached box while the right
controls sit outside it.

- The `SidebarTrigger` SHALL remain a direct child of the `<header>`, outside
  the inner wrap container, so it never reflows with the tabs or right
  controls regardless of viewport width.
- Within the inner wrap container, the tabs SHALL fill from the left; the
  right-side controls SHALL flow **after** the tabs in DOM order within the
  same wrap context.
- The `<nav role="tablist">` element that groups the tabs SHALL be preserved
  for accessibility, but SHALL use `display: contents` so its child tab
  buttons join the inner wrapper's `flex-wrap` flow directly.
- The right-side controls SHALL be grouped in a single element carrying
  `ml-auto`, so that on whatever flex line that group lands it is pushed to
  the right edge while left-aligned items on the same line hug the left.
  Because the right group always follows all tabs in DOM order, it always
  lands on the last (or a shared-last) line — yielding left-aligned items on
  the left and right controls on the right of that final line.
- The AppBar SHALL NOT introduce any `overflow-x` / `overflow-y` utility on
  the header, the inner wrapper, or the nav (wrapping is the overflow
  strategy); this preserves the existing guard against shadcn Button's
  `active:translate-y-px` producing a stray scrollbar.

#### Scenario: SidebarTrigger stays pinned left and never wraps
- **WHEN** the AppBar renders at any viewport width, including narrow widths
  where the tabs wrap across multiple lines
- **THEN** the `SidebarTrigger` remains the left-most control on the first
  line and never reflows into or below the tab rows

#### Scenario: Wide viewport keeps a single row, controls right-aligned
- **WHEN** the AppBar renders on a viewport wide enough to fit every item on
  one line
- **THEN** the `SidebarTrigger` sits at the far left and all tabs sit
  left-aligned beside it, with the right-side control group pushed to the
  right edge of that single line (visually identical to the prior layout)

#### Scenario: Narrow viewport wraps the tabs + controls as one shared flow
- **WHEN** the AppBar renders on a narrow (mobile) viewport too small to fit
  all items on one line
- **THEN** the trigger stays pinned at the top-left while the tabs wrap
  across multiple lines filling from the left, and the right-side control
  group flows onto the last shared line (or its own trailing line) rather
  than being pinned vertically-centered against a multi-row tab block

#### Scenario: Final line aligns left items left and right group right
- **WHEN** the items wrap such that one or more tabs share the final line
  with the right-side control group
- **THEN** the tab(s) on that line are left-aligned and the right-side
  control group is right-aligned, separated by the `ml-auto` free space

#### Scenario: Tab grouping remains a tablist
- **WHEN** the AppBar renders
- **THEN** the tabs remain wrapped in a `role="tablist"` element (via
  `display: contents`) and each tab keeps its `role="tab"` /
  `aria-selected` semantics

### Requirement: Code Review tab label is title-cased

The AppBar's code-review view tab SHALL be labeled `Code Review` (both words
title-cased), consistent with the other title-cased tab labels
(`Experiments`, `Hypotheses`, `Journal`, `Reports`, `Digests`).

#### Scenario: Tab renders title-cased label
- **WHEN** the AppBar renders the code-review tab
- **THEN** its visible label text is exactly `Code Review` (not `Code
  review`)
