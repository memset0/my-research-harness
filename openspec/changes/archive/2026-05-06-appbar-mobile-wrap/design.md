## Context

Current AppBar markup:

```tsx
<header className="sticky top-0 z-20 flex h-12 shrink-0 items-center
                   gap-2 border-b bg-background px-3 md:px-4">
  <SidebarTrigger className="md:hidden" />
  <nav className="flex items-center gap-1" role="tablist">
    {/* 5 tabs as <Button asChild><Link>…</Link></Button> */}
  </nav>
</header>
```

The header is a single-row flex container with `h-12`, locking its
height to 48px. The nav inside has no flex-wrap and no width
constraint, so its intrinsic width = sum of tab widths. When that
sum exceeds the available horizontal space (header width − trigger
width − gaps), the inner content overflows; the existing
`overflow-x-auto`-avoidance comment in the file documents the
trade-off (an x-scroller on the nav would create a 1px y-scroller
because of shadcn Button's `active:translate-y-px`).

So today, the overflow goes UP one level: the header is wider than
the viewport, and the body gets a horizontal scrollbar.

## Goals / Non-Goals

**Goals:**
- The header height grows with the wrapped tab count (1 row = 48px,
  2 rows ≈ 80px, etc.). No horizontal page scroll on phone widths.
- `SidebarTrigger` stays vertically centered regardless of row count.
- No regression on desktop (where there's plenty of room and the
  trigger is `md:hidden`).

**Non-Goals:**
- Don't add a "more" overflow menu. The user explicitly wants the
  tabs to wrap, not collapse.
- Don't introduce a horizontal-scroll affordance. The earlier
  comment (about the y-scroller artifact from
  `active:translate-y-px`) still applies.
- Don't re-style or reorder the tabs. Visual identity stays.

## Decisions

**D1. `min-h-12` instead of `h-12` on the header, plus small
vertical padding.** `min-h-12` keeps the 48px floor so single-row
headers don't shrink, while letting wrap grow the box. Add `py-1.5`
to give breathing room between the tab buttons (size-sm = 24px tall)
and the border on multi-row layouts; on single-row layouts the
buttons + py-1.5 still fit inside the 48px floor (24 + 24 = 48).

**D2. `flex-wrap` on the nav, with `flex-1 min-w-0`.** Without
`flex-1`, the nav stays at intrinsic content width and overflows the
header. With `flex-1`, the nav takes the remaining row width (after
the trigger), and `min-w-0` is needed because flex items default to
`min-width: auto` (= content min-width) — without it, the wrap won't
trigger when content exceeds available width.

**D3. Don't change `gap-1` to a different y/x split.** With
`flex-wrap`, the existing `gap-1` covers both row-gap and column-gap
(Tailwind `gap-N` shorthand), so vertically-stacked tabs get a 4px
inter-row gap automatically.

**D4. Keep `items-center` on the header.** This is the lever for
"trigger stays vertically centered". With multi-row nav, the
trigger centers vertically against the nav block — exactly what the
user asked for.

## Risks / Trade-offs

- [Risk] On a viewport so narrow that even ONE tab overflows the row,
  the layout would wrap a single tab per row. → Mitigation: that's
  still better than horizontal page scroll; users on this kind of
  viewport are rare and the result remains usable.
- [Risk] The page heading area below the AppBar must scroll-anchor
  correctly even when the AppBar grows. → No issue; `sticky top-0`
  on the header already handles this — the body's scroll origin is
  the header's bottom edge regardless of its current height.

## Migration Plan

Code-only edit. No spec backout step needed beyond `git revert`.

## Open Questions

None.
