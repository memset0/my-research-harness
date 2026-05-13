## Why

Experiment and run README bodies often include LaTeX math (e.g.
distillation losses, KL terms, log-prob expressions) written with the
de-facto markdown math syntax — `$...$` for inline and `$$...$$` for
display blocks. The current `<Markdown>` renderer in `apps/web` only
loads `remark-gfm`, so dollar-delimited math passes through as literal
text. On pages like
`/p/casual-parallel-drafting/e/E0005-distill-loss-sweep-casual-head-qwen3-8b`
this produces broken-looking prose with bare `$\mathcal{L}$` strings
where formulas should be. The fix is to add a math pipeline to the
shared `<Markdown>` component so every surface that renders exp/run
markdown picks it up uniformly.

## What Changes

- Add `remark-math` to the remark plugin chain and `rehype-katex` to the
  rehype plugin chain on `apps/web/components/markdown.tsx`.
- Import KaTeX's stylesheet exactly once so display/inline math has the
  fonts and spacing it needs. Loading happens via the shared
  `<Markdown>` component (or a global import in `app/layout.tsx`) so it
  does NOT have to be added per-page.
- Pin the KaTeX major version in `apps/web/package.json` alongside
  `react-markdown` / `remark-gfm` so the toolchain is reproducible.
- Add a verification fixture: a unit/browser test that renders a string
  containing `$...$` and `$$...$$` and asserts the output contains
  `.katex` / `.katex-display` markup.
- No CLI / `@memon/core` changes. No on-disk schema change. No
  `FS_CONVENTION_VERSION` bump.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `web-dashboard`: the shared markdown renderer SHALL convert
  `$...$` and `$$...$$` LaTeX expressions to rendered math output
  wherever exp-doc or run-README markdown is shown (exp body sections,
  run panels, inbox viewer).

## Impact

- **Code**: `apps/web/components/markdown.tsx` (plugin chain + CSS
  import), `apps/web/package.json` (new dev deps).
- **Bundle**: KaTeX adds ~280 KB gzipped JS plus a CSS file with web
  fonts. Loaded only on routes that render `<Markdown>`, which today
  means every exp-doc / run / inbox surface — acceptable given the
  audience is researchers reading formulas all day.
- **No backend change**: rendering is purely client-side. The stored
  markdown bytes are unchanged; existing READMEs that already contain
  `$...$` start rendering correctly with no migration.
- **Tests**: add one test under `apps/web/test/` (browser or jsdom,
  matching existing renderer tests) covering inline + display math.
- **Out of scope**: editor-side preview parity (the Monaco-based
  `ReadmeEditor` doesn't render math live yet) and any custom macros
  beyond stock KaTeX defaults.
