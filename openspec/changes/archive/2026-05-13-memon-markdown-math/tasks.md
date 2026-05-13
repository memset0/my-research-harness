## 1. Dependencies

- [x] 1.1 Add `remark-math@^6`, `rehype-katex@^7`, and `katex@^0.16` to `apps/web/package.json` (regular dependencies, alongside `react-markdown` / `remark-gfm`). Run `pnpm install` from the repo root so the lockfile updates and the workspace symlinks resolve.
- [x] 1.2 Confirm the installed `katex` package ships `dist/katex.min.css` and the AMS / web-font assets under `dist/fonts/` (so the Next.js CSS pipeline can resolve `import 'katex/dist/katex.min.css'`).

## 2. Renderer wiring

- [x] 2.1 In `apps/web/components/markdown.tsx`, add `import remarkMath from 'remark-math'`, `import rehypeKatex from 'rehype-katex'`, and `import 'katex/dist/katex.min.css'` at the top of the file.
- [x] 2.2 Extend the `<ReactMarkdown>` invocation: `remarkPlugins={[remarkGfm, remarkMath]}` and `rehypePlugins={[rehypeKatex]}`. Keep the existing `components={COMPONENTS}` override for task-list checkboxes.
- [x] 2.3 Add display-math layout safety to the `<Markdown>` root `cn(...)` class list: `'[&_.katex-display]:my-4'` and `'[&_.katex-display]:overflow-x-auto'`. These coexist with the existing `prose` / task-list / code-chip rules.
- [x] 2.4 Leave every call site of `<Markdown>` untouched (experiment-detail, experiment-page, inbox-shell, run panels). No per-page configuration is required.

## 3. Tests

- [x] 3.1 Add a renderer test next to the existing markdown-related tests (jsdom under `apps/web/test/` matches the project's convention) that renders a fixture containing both `$\\mathcal{L}_{KL}$` inline and `$$\\mathcal{L} = \\sum_i \\mathrm{KL}(p_i \\Vert q_i)$$` display math through `<Markdown>` and asserts that the output contains a `.katex` element for the inline case and a `.katex-display` element for the display case.
- [x] 3.2 Add a regression assertion in the same test: a fenced code block containing `export PRICE=$5` MUST render as `<pre><code>` with the literal `$5` and MUST NOT contain `.katex` markup inside the fence.
- [x] 3.3 Run `pnpm --filter @memon/web typecheck` and the test suite; both must pass.

## 4. Visual verification (CLAUDE.md F1 protocol)

- [x] 4.1 Kill the running dashboard on port 3737, rebuild prod (`pnpm --filter @memon/web build`), restart in the background, and wait for it to come up — per CLAUDE.md "Dev: prefer prod build for the dashboard".
- [x] 4.2 Read `auth.username` / `auth.password` from `config.yml` and `curl -sS -u "$MEMON_USER:$MEMON_PASS" http://localhost:3737/p/casual-parallel-drafting/e/E0005-distill-loss-sweep-casual-head-qwen3-8b | grep -E 'class="katex|class="katex-display'` — both classes MUST appear at least once.
- [x] 4.3 `curl -sS http://localhost:3737/_next/static/css/app/layout.css?v=$(date +%s) | grep -E '\\.katex(-display)?\\b'` (static assets bypass auth) — KaTeX rules MUST be present in the compiled CSS bundle.
- [x] 4.4 Spot-check one run panel page that contains no math, confirming non-math markdown still renders identically (code chips, task lists, prose typography).
- [x] 4.5 Spot-check one README that historically used `$` as a shell or shell-variable example (e.g. `$PATH`, `export X=$Y`). Confirm no spurious math interpretation outside actual `$...$` pairs.
