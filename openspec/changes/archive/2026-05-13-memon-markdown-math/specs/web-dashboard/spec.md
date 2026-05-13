## ADDED Requirements

### Requirement: Markdown body rendering supports LaTeX math

The shared `<Markdown>` component SHALL render LaTeX math expressions written with conventional dollar-sign delimiters wherever exp-doc or run-README markdown is shown (experiment-doc detail page, run panels, inbox viewer, and any future surface that uses the same component).

Specifically:

- Inline math wrapped in single dollars (`$...$`) SHALL render as
  inline KaTeX-rendered HTML inside the surrounding paragraph.
- Display math written as a `$$`-fenced block — i.e., `$$` on a line
  by itself, the formula body on one or more following lines, and a
  closing `$$` on its own line — SHALL render as a block-level
  KaTeX-rendered formula with display-style spacing. This matches the
  `micromark-extension-math` flow-construct grammar (analogous to a
  fenced code block, but with `$$` delimiters). Authors who instead
  write `$$x$$` inline on a single line SHALL get an inline KaTeX
  span, which is the documented standard behaviour of the toolchain
  and is acceptable for occasional one-liners.

Math expressions SHALL NOT be rendered inside fenced code blocks
(```), indented code blocks, or inline `<code>` spans — those continue
to be shown verbatim. Math content outside code SHALL coexist with
existing markdown features (GFM tables, task lists, footnotes,
syntax-highlighted code chips) without altering their rendering.

The required toolchain SHALL be `remark-math` in the remark plugin
chain and `rehype-katex` in the rehype plugin chain, with KaTeX's
stylesheet imported by the renderer module so the host application
loads it exactly once. The renderer MUST NOT depend on any runtime
CDN fetch for fonts or CSS.

#### Scenario: Inline math renders as KaTeX inside a paragraph

- **WHEN** an exp-doc README body contains a paragraph
  `The loss is $\mathcal{L}_{KL}$ across heads.`
- **THEN** the exp-doc detail page renders that paragraph with the
  `$\mathcal{L}_{KL}$` portion replaced by a `<span class="katex">…</span>`
  containing KaTeX-rendered math, and the surrounding text remains
  inline (no forced line break).

#### Scenario: Fenced display math renders as a KaTeX block

- **WHEN** an exp-doc README body contains a fenced display-math block
  written across three lines: a line containing just `$$`, then a line
  `\mathcal{L} = \sum_i \mathrm{KL}(p_i \Vert q_i)`, then a closing
  line `$$`
- **THEN** the exp-doc detail page renders that block as a
  `<span class="katex-display">…</span>` (or equivalent KaTeX block
  wrapper) on its own line, with the formula in display style and
  separated from surrounding paragraphs by block-level vertical
  spacing.

#### Scenario: Single-line `$$x$$` renders as an inline KaTeX span

- **WHEN** an exp-doc README body contains a paragraph that uses
  `$$\mathcal{L}$$` on a single line without a surrounding fence
- **THEN** the renderer produces an inline `<span class="katex">…</span>`
  inside the paragraph (matching the `micromark-extension-math`
  documented behaviour for one-line `$$`), and does NOT crash, drop
  the math, or render the raw dollars.

#### Scenario: Dollar signs inside fenced code blocks stay literal

- **WHEN** an exp-doc README body contains a fenced code block whose
  content includes a line `export PRICE=$5` (an unescaped `$` inside
  a fence)
- **THEN** the rendered code block shows `export PRICE=$5` verbatim
  with no math substitution and no `.katex` markup, preserving the
  fenced-block behavior of the renderer.

#### Scenario: Run-panel READMEs render math identically to exp docs

- **WHEN** the run panel for a run whose README contains both inline
  and display math is expanded inside an exp-doc page
- **THEN** the rendered `Setup` and `Result` sections show the math
  using the same KaTeX pipeline as the parent exp doc, with no
  per-surface configuration required by the caller.

#### Scenario: KaTeX stylesheet is bundled, not fetched at runtime

- **WHEN** the production build of `apps/web` is served and a page
  that uses `<Markdown>` is requested
- **THEN** the page's CSS bundle contains KaTeX style rules (e.g.,
  selectors targeting `.katex` / `.katex-display`), and the page
  network log shows zero requests to any external CDN host for KaTeX
  assets.
