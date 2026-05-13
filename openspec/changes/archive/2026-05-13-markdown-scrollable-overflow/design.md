## Context

`<Markdown>` (`apps/web/components/markdown.tsx`) is the only renderer
used for exp-doc and run-README bodies. Its output sits inside `Card`
sections (`apps/web/components/ui/card.tsx`), and the Card has
`overflow-hidden` on its outermost div so the rounded corners and ring
look correct. The Card style is correct chrome and we don't want to
fork it — that's exactly the F3 anti-pattern in CLAUDE.md.

In Flexbox / Grid descendants (which the Card eventually is, via the
exp-page two-column layout and the run-panel collapsible content),
the default min-content size of a child equals its intrinsic content
width. A wide table or KaTeX block therefore *pushes* the column
wide; in a fixed-width parent with `overflow-hidden`, that content is
clipped instead of scrolling, because the `<table>` itself has no
overflow context — its parent's overflow-hidden eats the excess.

The previous `memon-markdown-math` change already addressed display
math by adding `[&_.katex-display]:overflow-x-auto` to the
`<Markdown>` root. The fix for tables and fenced code follows the
same shape but needs one extra ingredient: the `<Markdown>` root
itself must allow shrinking, otherwise children with
`overflow-x-auto` never know they're constrained — they happily
match content width and never engage their scrollbar.

## Goals / Non-Goals

**Goals:**
- Wide GFM tables become horizontally scrollable inside the Card.
- Long fenced-code blocks become horizontally scrollable.
- Display math (already covered by the prior change) keeps scrolling.
- A single central change to `<Markdown>`; no per-call-site CSS.
- No regression to: code chips (inline `<code>`), short tables, task
  lists, prose typography, KaTeX display margins.

**Non-Goals:**
- Touching the `Card` primitive's `overflow-hidden`.
- Adding a "click table to expand fullscreen" affordance — out of scope.
- Wrapping long inline code in `<pre>` (would break inline flow).
- Mobile-specific responsive table strategies (stacked-row layouts,
  collapsing columns). The horizontal-scroll approach is enough and
  matches GitHub's own renderer.
- Inline KaTeX (`.katex` not inside `.katex-display`). Inline math is
  by construction part of a paragraph; if it really doesn't fit, the
  paragraph reflows. Adding `overflow-x-auto` to the inline span would
  break baseline alignment. We leave inline math alone.

## Decisions

### D1. Wrap tables via a `components.table` override

**Choice:** Add a `table` override to the `components` map passed to
`<ReactMarkdown>` that renders:

```tsx
<div className="my-4 w-full overflow-x-auto">
  <table {...props} />
</div>
```

The wrapping div carries the `my-4` so the prose `<table>` margin
collapses cleanly. `w-full` ensures the wrapper itself takes its
parent's full width so the scrollbar appears at the right edge of
the Card, not floating inside.

**Alternative considered:** Apply `[&_table]:block [&_table]:overflow-x-auto`
on the `<Markdown>` root. This works at first but `display: block`
on `<table>` breaks `<colgroup>` / column layout and makes
`width: 100%` behave inconsistently. The wrapper-div approach is the
GitHub-renderer convention and is the one shadcn's typography demos
show too.

### D2. Add `min-w-0` to the `<Markdown>` root

**Choice:** Extend the existing `cn(...)` class list on the
`<Markdown>` root with `min-w-0`.

**Why this is load-bearing:** Without `min-w-0`, the `<Markdown>`
wrapper inherits flex/grid's default `min-width: auto`, which equals
its intrinsic content min-width. Children with `overflow-x-auto`
therefore see "available width = my content width" and never engage
their scrollbar — the overflow just pushes the wrapper out instead.
This is the well-known "min-width-0 hack" required for any flex/grid
child that wants its descendants to scroll horizontally.

Putting it on the `<Markdown>` root (rather than on every consumer)
keeps the fix central and lets every surface inherit it.

### D3. Confirm `<pre>` overflow-x via prose defaults, override only if needed

**Choice:** `@tailwindcss/typography`'s `prose` already adds
`overflow-x: auto` to `<pre>` blocks. We will verify that the rule
survives our existing overrides (the `[&_pre_code]:bg-transparent`
chain is on `<code>` inside `<pre>`, not on `<pre>` itself). If the
verification step shows long fenced-code blocks still clip, add an
explicit `[&_pre]:overflow-x-auto` rule. This is a verify-then-fix
decision rather than blindly adding a redundant rule.

### D4. Verification follows CLAUDE.md F1

After implementation:
1. Render a fixture with a wide table and a wide fenced-code block
   through `<Markdown>` in jsdom; assert each is wrapped in / sits
   inside an `overflow-x-auto` container.
2. Build prod and `curl` E0005 to confirm the page still 200s and
   the CSS bundle is unchanged in token coverage (sanity).
3. The user (or a real browser) eyeballs E0005 to confirm the loss
   table now scrolls horizontally inside the Card.

## Risks / Trade-offs

- **Horizontal scrollbars inside Cards look slightly different from
  the rest of the chrome**. Mitigated by `w-full my-4` so the
  scrollbar sits flush with the Card content padding and inherits
  the page's native scrollbar style.
- **Long click targets in table cells become slightly less
  discoverable on touch devices** if the scroll bar is hidden until
  hover. Acceptable for a research dashboard whose primary users are
  on desktops/laptops.
- **`min-w-0` propagation interaction with future flex layouts**:
  consumers that *want* the wrapper to grow past its parent (e.g.,
  to push siblings) would be surprised. We don't have any such
  consumer today, and the Markdown body is always the "shrinkable"
  child by intent.
- **Risk of double scrollbars** if a consumer wraps `<Markdown>` in
  its own `overflow-x-auto`. None today; future consumers can omit
  redundant overflow rules.

## Migration Plan

- One-shot code change to `markdown.tsx` plus a new jsdom test.
- No data migration.
- Rollback: revert the commit.

## Open Questions

- Should we also add a subtle hint (e.g., right-edge gradient fade)
  signalling that a table is horizontally scrollable? GitHub's
  renderer doesn't. Default to **no** for now; revisit if users
  miss the affordance.
