## Context

The shared markdown renderer lives at `apps/web/components/markdown.tsx`
and is used by `experiment-detail`, `experiment-page`, `inbox-shell`,
and the run panels (transitively, via the same component). It currently
loads `react-markdown@^10` with a single remark plugin (`remark-gfm`)
and a single `components` override that disables GFM task-list
checkboxes. There is no math plugin in the chain, so dollar-delimited
LaTeX is emitted as literal text.

The web app is Next.js 15 App Router + Tailwind v4 + shadcn/ui. We
already have an established `prose ... dark:prose-invert` wrapper on
the `<Markdown>` root, and a careful set of `[&_pre_code]:...` /
task-list CSS selectors. Any math styling has to coexist with that.

Researchers writing exp-doc and run-README markdown commonly include
math; the user explicitly cited
`/p/casual-parallel-drafting/e/E0005-distill-loss-sweep-casual-head-qwen3-8b`
as broken today.

## Goals / Non-Goals

**Goals:**
- Inline math (`$...$`) and display math (`$$...$$`) render correctly
  on every surface that uses `<Markdown>`.
- A single, central plugin chain change — no per-call-site
  configuration. Touching `markdown.tsx` is the entire diff for the
  rendering side.
- KaTeX CSS is loaded exactly once and survives a production build
  (i.e., bundling via `import 'katex/dist/katex.min.css'` works under
  Next.js's CSS pipeline, not pulled via a CDN `<link>` tag).
- Existing surfaces (code chips, task lists, `prose` typography) keep
  rendering exactly as before for non-math content.

**Non-Goals:**
- Live math preview inside the Monaco `ReadmeEditor`. That editor shows
  raw source; preview comes from the rendered side. We can add a
  preview pane later if requested, but it is not part of this change.
- Custom KaTeX macros / `\newcommand` packaging for the project. Stock
  KaTeX (which already understands the bulk of LaTeX-math, AMS macros,
  matrix environments, etc.) is enough for the cited use case.
- MathML / accessibility tree tuning beyond KaTeX defaults.
- Server-side rendering of math. KaTeX runs client-side via
  `rehype-katex`; the SSR HTML will contain the KaTeX-rendered markup
  too (rehype runs at render time, not in the browser), but we are
  not introducing a separate SSR-only path.

## Decisions

### D1. Use `remark-math` + `rehype-katex` (not `rehype-mathjax`, not a custom regex)

**Choice:** Add `remark-math` to the remark plugin chain and
`rehype-katex` to the rehype plugin chain. Pin the matching majors
(`remark-math@^6`, `rehype-katex@^7`, `katex@^0.16`).

**Alternatives considered:**
- `rehype-mathjax`: produces SVG/HTML via MathJax. Larger bundle, no
  net benefit for our content, and stylesheet is less prose-friendly.
- A hand-rolled regex replacement inside our `components` override:
  brittle, breaks inside fenced code blocks and inline `<code>`,
  doesn't handle escaping. Rejected on F4-style reasoning — we should
  use the toolchain everyone in the markdown ecosystem already uses.

**Why this works with our current chain:** `react-markdown@10` already
exposes both `remarkPlugins` and `rehypePlugins` props. `remark-math`
runs first (parses `$...$` / `$$...$$` into AST math nodes);
`rehype-katex` runs after and replaces them with KaTeX HTML.

### D2. Load `katex/dist/katex.min.css` via a static import inside `markdown.tsx`

**Choice:** Add `import 'katex/dist/katex.min.css'` at the top of
`apps/web/components/markdown.tsx`. Next.js's CSS pipeline picks up
package CSS imports from client components and ships them with the
route's stylesheet bundle.

**Alternatives considered:**
- Import in `app/layout.tsx` so it loads on every route, even ones with
  no markdown. Rejected — wastes ~25 KB on routes that don't render
  prose (e.g., the bare login page).
- CDN `<link>` tag. Rejected — adds an external dependency at runtime,
  hurts air-gapped / offline cluster scenarios.

**Coexistence with `prose`:** KaTeX CSS uses its own `.katex` /
`.katex-display` class hierarchy under the renderer root. It does not
inherit `prose` font-size, but the existing `prose-sm` text size and
KaTeX's `1em`-relative metrics combine without issue in practice. We
will visually verify on the cited E0005 page (CLAUDE.md F1 protocol)
and tune with a tiny `[&_.katex-display]:my-4` selector if spacing
collides with `prose` paragraph margins.

### D3. Keep the existing `components` override for task-list checkboxes

The disabled-checkbox override is orthogonal to math and stays. The
plugin chain becomes:

```ts
<ReactMarkdown
  remarkPlugins={[remarkGfm, remarkMath]}
  rehypePlugins={[rehypeKatex]}
  components={COMPONENTS}
>
```

### D4. Verification follows CLAUDE.md F1 / F4

Per the repo's "claiming UI done" rule, after wiring the plugin chain
the implementer MUST:
1. Render a string with both inline and display math through `<Markdown>`
   in a test (jsdom/browser) and assert `.katex` / `.katex-display`
   markup appears.
2. Build prod, `curl` the cited E0005 exp page through `caddy` with
   Basic auth (per CLAUDE.md "Dev: HTTP API auth" section), and grep
   the served HTML for `class="katex"` to confirm SSR ships the
   rendered math.
3. `curl` the compiled CSS bundle and grep for `.katex` rule names to
   confirm the KaTeX stylesheet got picked up by Next's CSS pipeline.

## Risks / Trade-offs

- **Bundle size**: `katex` is ~280 KB minified JS (+ ~25 KB CSS + web
  fonts). → Mitigation: scoped to the bundle of routes that render
  `<Markdown>`, which is already the heavy "data" half of the app;
  acceptable. Researchers on dashboards aren't on hostile networks.
- **CSS specificity collisions with `prose`**: `prose` sets margins on
  paragraphs and headings that can squeeze `.katex-display` blocks.
  → Mitigation: explicit `[&_.katex-display]:my-4 [&_.katex-display]:overflow-x-auto`
  rules on the `<Markdown>` root if visual verification shows tight
  spacing or overflow on narrow viewports.
- **Tests in jsdom**: KaTeX renders synchronously to HTML, so its DOM
  output is straightforward to assert on. No async waits needed.
- **Server-rendered HTML may differ from client**: Because the renderer
  runs on both, hydration mismatch is possible if extensions are
  inconsistent. → Mitigation: both `remark-math` and `rehype-katex` are
  pure functions of input markdown; SSR and CSR produce identical HTML.
- **Existing READMEs that use `$` as literal dollar (price, shell var)**:
  Now interpreted as math. → Mitigation: stock `remark-math` already
  requires a paired second `$` AND non-whitespace around the contents;
  isolated `$` in prose still renders as text. If a real conflict is
  discovered, users can escape with `\$`. We will spot-check during
  verification.

## Migration Plan

No on-disk migration; rendering-only change. Deploy strategy:
1. Implement the plugin chain + CSS import on a branch.
2. Run the verification protocol against `/p/casual-parallel-drafting/e/E0005-distill-loss-sweep-casual-head-qwen3-8b`
   and at least one run-panel page with no math, to confirm regression-free.
3. Merge & rebuild prod (`pnpm --filter @memon/web build && pnpm start`).

Rollback: revert the single commit touching `markdown.tsx` + lockfile.

## Open Questions

- Do we want a `[&_.katex-display]:overflow-x-auto` rule out of the gate
  for wide formulas on mobile, or wait until a user reports clipping?
  → Default to including it (cheap; matches GitHub's renderer).
- Should the editor (`ReadmeEditor` / Monaco) get a preview pane that
  uses the same `<Markdown>` component? → Deferred; not in this change.
