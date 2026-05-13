## ADDED Requirements

### Requirement: Markdown body overflow is scrollable, not clipped

The shared `<Markdown>` component SHALL ensure that wide content
(GFM tables, fenced code blocks, and KaTeX display formulas)
becomes horizontally scrollable inside its parent container rather
than being clipped, on every surface that renders exp-doc or
run-README markdown (experiment-doc detail page, run panels, inbox
viewer).

Specifically:

- Every GFM `<table>` rendered by the component SHALL be wrapped in
  a block-level container with `overflow-x-auto` so that a wide
  table produces a horizontal scrollbar within the parent Card
  rather than clipping its rightmost columns.
- Fenced code blocks (`<pre>`) SHALL scroll horizontally when their
  content exceeds the available width — either by inheriting the
  prose `overflow-x: auto` default or by an explicit override on
  the `<Markdown>` root.
- KaTeX display blocks (`.katex-display`) SHALL continue to scroll
  horizontally as specified by the prior change.
- The `<Markdown>` root SHALL set `min-width: 0` (Tailwind
  `min-w-0`) so that, when placed inside a flex or grid parent,
  its descendants' `overflow-x-auto` actually engages instead of
  the wrapper expanding past its share and being clipped by an
  ancestor's `overflow-hidden`.
- The fix SHALL be implemented in the renderer; the `Card`
  primitive (`apps/web/components/ui/card.tsx`) MUST NOT be
  modified to drop `overflow-hidden`.

#### Scenario: Wide GFM table scrolls inside the Card

- **WHEN** an exp-doc README body contains a GFM table whose
  intrinsic width exceeds the available column width on the
  exp-doc detail page (e.g., the multi-column loss-formula table
  in the cited E0005 README)
- **THEN** the rendered table is wrapped in a block-level
  `overflow-x-auto` container so the user can horizontally scroll
  to see all columns, and no cell content is clipped by the
  parent Card.

#### Scenario: Wide fenced code block scrolls horizontally

- **WHEN** a markdown body contains a fenced code block with a
  very long single line (e.g., a long shell command without line
  breaks)
- **THEN** the rendered `<pre>` shows a horizontal scrollbar; the
  line is NOT wrapped, NOT truncated, and NOT clipped by an
  ancestor's `overflow-hidden`.

#### Scenario: Short tables do not show a scrollbar

- **WHEN** a markdown body contains a short two-column GFM table
  that fits well within the available width
- **THEN** the rendered table is still wrapped in the
  `overflow-x-auto` container but no horizontal scrollbar is
  visible (because there is no overflow), and the table renders
  with the usual prose spacing.

#### Scenario: Markdown root carries `min-w-0`

- **WHEN** the `<Markdown>` component renders any content
- **THEN** the outermost wrapper div's class list contains
  `min-w-0` so that flex/grid ancestors do not force the wrapper
  to its content's min-width, which would otherwise defeat the
  child-level `overflow-x-auto` scroll containers.
