## 1. Implementation

- [x] 1.1 Schema + model: add `x_from_zero`/`y_from_zero` to the plot view, keep raw `y` labels and numeric `x` on `PlotPoint`; update `index.test.ts` / series tests.
- [x] 1.2 Renderer: data-fitted domains by default, zero anchors on request, numeric x axis for numeric-x line views, raw-text tooltip; render tests for close values, zero anchor and tooltip text.
- [x] 1.3 Regenerate the `memon-components` skill table (`node scripts/component-docs.mjs --write` then `--check`); mirror to `.claude/skills`.

## 2. Verification

- [x] 2.1 Targeted tests (`apps/web/lib/components/datatable/v1/*.test.*`, skills tests), `pnpm --filter @memon/web typecheck`, and a browser check of a rendered wiki block with close values (axis range, tooltip digits).
