## Why

`datatable@1` can show a dataset as a table, a line, or a bar chart. Two common reading needs are missing: judging how two measured quantities relate (e.g. a hyperparameter against a metric, or one metric against another), and narrowing a long table to the rows that matter without leaving the page. Both fit the existing block shape, so they can be added to `datatable@1` as purely additive, optional schema — every existing block keeps validating and rendering identically, and no `datatable@2` is needed.

## What Changes

- Add a `scatter` plot view type. It takes the same roles as `line`/`bar` (`x`, `y`, optional `series`, `tabs`, `select`, `x_from_zero`, `y_from_zero`) and draws every kept row as its own dot on two numeric axes, one colour per series. Rows whose `x` or `y` is not numeric are skipped and counted.
- Add author-declared, named row filters to the `table` view:
  - `filters: [{ label, where, default? }]`, where `where` maps column names to a matcher (scalar equality, a list of allowed values, or a comparison object with `eq`/`ne`/`in`/`not_in`/`lt`/`lte`/`gt`/`gte`).
  - `filter_mode: any` (default) — the reader toggles 0..N filters on; active filters combine with AND.
  - `filter_mode: one` — the reader picks at most one filter (an `All` chip clears it).
  - `default: true` marks filters active on first render (at most one in `one` mode).
  - Filters render as a row of toggle chips above the table (not dropdowns), with a "shown N of M rows" count.
- Validation extends the existing refine: filter labels unique within a view, `where` columns must exist, `one` mode allows at most one default.
- Descriptor text, example, and the generated `memon-components` skill table are updated to document the new fields.
- Not breaking: all new fields are optional and the new view type is a new discriminant value. Blocks using the new fields render only on a central instance that has this change; an older instance shows them verbatim with `WIKI_COMPONENT_INVALID` until it is updated.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `document-components`: the `datatable@1` requirement gains the `scatter` view type and table-view named filters.

## Impact

- Code: `apps/web/lib/components/datatable/v1/` (`index.ts` schema/refine/descriptor text, `series.ts` scatter model and row-filter predicate, `render.tsx` filter chips, `plot.tsx` scatter chart) plus their tests.
- Generated outputs: `node scripts/component-docs.mjs --write` regenerates the `memon-components` skill table (skills artifact change → MINOR release bump).
- No filesystem convention, CLI, API, or backend change; component blocks stay opaque to the CLI and backends.
- Dependencies: none new (recharts already provides `ScatterChart`).
