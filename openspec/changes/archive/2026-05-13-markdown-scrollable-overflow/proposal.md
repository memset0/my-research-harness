## Why

Wide content inside markdown bodies — GFM tables with many columns,
long KaTeX display formulas, long fenced-code lines — currently
overflows the available row width and gets visually clipped instead
of becoming scrollable. The clip happens because the `Card` primitive
that wraps every body section (`apps/web/components/ui/card.tsx`)
carries `overflow-hidden`, which is the right call for a Card's
overall chrome (rounded corners, shadow, header/footer) but means
any oversized child silently loses content past the right edge.
On the exp-doc detail page this hides whole loss-formula columns of
the E0005 README, and at minimum the rightmost cells of any wide
markdown table on any surface that uses `<Markdown>`.

The previous change `memon-markdown-math` already opted
`.katex-display` into horizontal scroll for that one specific class.
We now generalize the same idea to the remaining overflow-prone
elements that the renderer emits.

## What Changes

- The shared `<Markdown>` renderer SHALL render GFM tables inside an
  `overflow-x-auto` wrapper so wide tables become horizontally
  scrollable inside the Card.
- The shared `<Markdown>` renderer SHALL ensure fenced code blocks
  (`<pre>`) and inline KaTeX (`.katex` outside `.katex-display`)
  scroll horizontally when their content exceeds the available
  width, rather than clipping.
- The `<Markdown>` root wrapper SHALL carry `min-w-0` so its flex /
  grid parent allows the wrapper itself to shrink below intrinsic
  child width, which is the only way `overflow-x-auto` on children
  can actually engage inside a constrained Card layout.
- No change to the `Card` primitive's `overflow-hidden` (that
  remains the correct chrome behaviour); the fix is scoped to the
  contents of `<Markdown>`.
- No on-disk schema or API change.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `web-dashboard`: extends the existing
  `Markdown body rendering supports LaTeX math` requirement /
  introduces overflow-scroll behaviour for wide markdown content
  (tables, fenced-code blocks, math) on every surface that uses
  the shared `<Markdown>` component.

## Impact

- **Code**: `apps/web/components/markdown.tsx` (add a
  `components.table` override that wraps in a div with
  `overflow-x-auto`; add `min-w-0` to the root; verify `<pre>`
  inherits `overflow-x-auto`; extend the `.katex` selector if
  inline KaTeX needs it).
- **No new dependencies**.
- **Tests**: extend `apps/web/components/markdown.test.tsx` with
  fixtures rendering a wide table + a wide fenced-code block and
  asserting the resulting DOM has the expected `overflow-x-auto`
  wrappers.
- **Visual verification**: F1 protocol against the E0005 page —
  the loss-formula table that currently clips must show a
  horizontal scrollbar inside the Card.
- **Out of scope**: redesigning the Card chrome, soft-wrapping
  inline content (which would break code line integrity), or
  collapsing tables on narrow viewports.
