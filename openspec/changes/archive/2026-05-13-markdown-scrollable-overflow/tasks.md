## 1. Renderer wiring

- [x] 1.1 In `apps/web/components/markdown.tsx`, add `min-w-0` to the root `cn(...)` class list so flex/grid ancestors allow the wrapper to shrink below intrinsic child width.
- [x] 1.2 Add a `table` entry to the `COMPONENTS` map that wraps `<table>` in `<div className="my-4 w-full overflow-x-auto"><table {...rest}/></div>`. Preserve all incoming props (className, etc.) on the inner `<table>`.
- [x] 1.3 Verify that fenced `<pre>` blocks scroll horizontally under the existing `prose` defaults — render a fixture with a very long single-line code block in the jsdom test from task 2.2 and inspect the computed style. If they don't scroll (jsdom can be unreliable here, so also visually verify in step 3.3), add `'[&_pre]:overflow-x-auto'` to the root `cn(...)` class list.

## 2. Tests

- [x] 2.1 Extend `apps/web/components/markdown.test.tsx` with a "wide GFM table" fixture (e.g., a 6-column table with long cell content) and assert: (a) the `<table>` is wrapped in a div with `class*="overflow-x-auto"`, and (b) the wrapper has `w-full` and a margin class. Also assert non-table content is untouched.
- [x] 2.2 Add a "wide fenced code block" fixture (a fence containing a single long line ~200 chars). Assert that either the `<pre>` itself or an ancestor inside `<Markdown>`'s root has `overflow-x-auto` semantics (via the className grep — we don't need to assert real layout in jsdom).
- [x] 2.3 Add a "short table" fixture to assert that the wrapper div still appears (no special-casing) but the table content fits.
- [x] 2.4 Run `pnpm --filter @memon/web typecheck` and `pnpm --filter @memon/web test` — all must pass with no regressions in the 275-test baseline.

## 3. Visual verification (CLAUDE.md F1)

- [x] 3.1 Kill the running dashboard on port 3737, rebuild prod (`pnpm --filter @memon/web build`), restart, and wait for "memon ready" in the log.
- [x] 3.2 Read `auth.username` / `auth.password` from `config.yml`, then `curl -sS -o /dev/null -w "%{http_code}\n" -u "$MEMON_USER:$MEMON_PASS" http://localhost:3737/p/casual-parallel-drafting/e/E0005-distill-loss-sweep-casual-head-qwen3-8b` and confirm 200.
- [x] 3.3 Eyeball the E0005 page in the browser: confirm the multi-column loss-formula table now shows a horizontal scrollbar inside the Card (instead of having its rightmost columns clipped). Confirm KaTeX display blocks (added by the previous change) still scroll.
- [x] 3.4 Spot-check one run-panel page whose README has only short tables / no math — non-wide content must render identically to before (no extra scrollbar, no layout shift).
