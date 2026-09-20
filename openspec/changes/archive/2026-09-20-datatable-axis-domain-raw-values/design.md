## Context

`plot.tsx` hands recharts `XAxis dataKey="x"` (category) and a bare `YAxis` (domain `[0, auto]`), and uses the stock `ChartTooltipContent`, which renders numbers with `toLocaleString()`. `series.ts` already computes `numericX` and parses each `x`, but drops the numeric value after sorting and keeps only the display label.

## Decisions

1. **Schema**: `plotView` gains `x_from_zero: z.boolean().optional()` and `y_from_zero: z.boolean().optional()` (snake_case like every other payload key). Absent = fit to data. Unknown keys still fail (`.strict()`).
2. **Model**: `PlotPoint` carries `xNumber: number | null` and `labels: Record<string, string>` (raw `y` cell text per series, from `cellLabel`) beside `values`. `PlotModel.numericX` is unchanged.
3. **Axes** (`plot.tsx`):
   - y: `domain={view.y_from_zero ? [0, 'auto'] : ['auto', 'auto']}` on both chart types. recharts `'auto'` on the lower bound picks a nice tick below the data minimum rather than zero.
   - x on `line` with `model.numericX`: `type="number"`, `dataKey` the numeric value, `domain={view.x_from_zero ? [0, 'dataMax'] : ['dataMin', 'dataMax']}`; otherwise (categorical, or any `bar`) unchanged category axis.
4. **Tooltip**: a local `formatter` renders the series indicator, name and `point.labels[name]`; `labelFormatter` renders the hovered point's raw `x` text. The row object keeps a reference to its `PlotPoint` under a key that cannot be a column-derived series name (`Symbol` is not spread by recharts, so a NUL-prefixed string key is used and documented).
5. **Table view** already renders `cellLabel(cell)` verbatim; untouched. Precision is bounded by YAML parsing (a float literal becomes a JS double before the renderer sees it) — declare as a string to keep more digits, which the plot still parses through `cellNumber`.
6. **Docs**: `views` description updated in the descriptor; skill table regenerated with `node scripts/component-docs.mjs --write`; `--check` must pass.

## Risks

- `domain=['auto','auto']` with a single point or an all-equal series: recharts pads to a valid range; covered by a render test with equal values.
- Numeric x on `line` changes the look of existing wiki plots with numeric steps (now to scale). This is the intended fix.
