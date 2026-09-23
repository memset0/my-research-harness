## MODIFIED Requirements

### Requirement: `datatable@1` shows one dataset through table, line, and bar views

`datatable@1` SHALL accept `columns: string[]` (non-empty, unique), `data: unknown[][]` (every row exactly `columns.length` long), optional `title`, optional `note`, and `views: View[]` (default `[{ type: "table" }]`, at least one). `View.type` SHALL be `table`, `line`, `bar`, or `scatter`. `line`, `bar`, and `scatter` SHALL require `x` and `y` (column names) and accept optional `series`, `tabs`, and `select` column names; every named column SHALL exist and the four roles SHALL be distinct. Rendering SHALL show a view switcher when more than one view exists; `table` SHALL render a horizontally scrollable table; `line`/`bar` SHALL plot `y` against `x`, drawing one series per distinct `series` value (in first-appearance order) or a single series when absent; `tabs` SHALL render a tab per distinct value (outer), `select` a dropdown per distinct value (inner, scoped to the current tab), both optional and orthogonal, both in first-appearance order, and the plotted rows SHALL be those matching the current tab and selection. Values that are not numbers on `y` SHALL be skipped and the plot SHALL state how many rows were skipped. Schema violations SHALL be reported as `WIKI_COMPONENT_INVALID` and the block SHALL stay verbatim. Plot views SHALL fit both axes to the plotted values by default: the y domain SHALL span the data rather than start at zero, and a `line` view whose kept `x` cells are all numeric SHALL use a numeric x axis spanning the data (`bar` views keep a categorical x axis). Optional boolean view fields `x_from_zero` and `y_from_zero` SHALL anchor the respective axis at zero. Hover tooltips SHALL print the raw cell text of the hovered `x` and of every plotted `y` value exactly as declared, never a rounded or locale-formatted rendering. A `line` view SHALL mark every plotted data point with a visible dot on its line so measured points are distinguishable from the interpolated segments.

A `scatter` view SHALL draw every kept row as its own dot on two numeric axes (rows sharing an `x` value are not merged), colouring dots by `series` value in first-appearance order with a legend when more than one series exists, and SHALL follow the same `tabs`/`select` filtering, axis-fitting, zero-anchor, and raw-tooltip rules as the other plot views; rows whose `x` or `y` cell is not a number SHALL be skipped and counted in the skipped-row note.

A `table` view SHALL accept optional `filters: { label: string, where: Where, default?: boolean }[]` and optional `filter_mode: "any" | "one"` (default `any`). `label` SHALL be non-empty and unique within the view. `where` SHALL be a non-empty mapping from existing column names to a matcher, and a row SHALL match a filter only when it satisfies every entry of its `where`. A matcher SHALL be a scalar (the cell matches when its text equals the scalar's text), a list of scalars (the cell's text equals any listed value's text), or an operator object with at least one of `eq`, `ne` (text equality/inequality), `in`, `not_in` (lists of scalars), and `lt`, `lte`, `gt`, `gte` (numbers; a cell that is not a number fails every numeric comparison); all operators in one object SHALL hold. Filters SHALL render as a row of toggle chips above the table, in declaration order, never as a dropdown. In `any` mode the reader SHALL be able to turn any subset of filters on or off and the shown rows SHALL be those matching every active filter (all rows when none is active). In `one` mode at most one filter SHALL be active; an additional leading `All` chip SHALL clear the active filter, and choosing a filter SHALL replace the previously active one. Filters marked `default: true` SHALL be active on first render; `one` mode SHALL allow at most one default. When the view declares filters the table SHALL state how many of the total rows are shown, and when no row matches it SHALL say so instead of rendering an empty body. Filter state SHALL be per rendered block and SHALL NOT alter the payload or other views. A `filters` or `filter_mode` field on a plot view, an unknown column in `where`, a duplicate label, an empty `where`, an empty operator object, or more than one default in `one` mode SHALL be schema violations. Blocks that use none of these fields SHALL validate and render exactly as before.

#### Scenario: Two experiments, two metrics, several runs
- **GIVEN** columns `[experiment, metric, run, step, value]` and a `line` view with `x: step`, `y: value`, `series: run`, `tabs: experiment`, `select: metric`
- **WHEN** the reader picks tab `E0021` and metric `fid`
- **THEN** one line per run of `E0021` with metric `fid` is drawn, and switching the tab resets the dropdown to that tab's first metric

#### Scenario: Invalid view column
- **WHEN** a view names `x: epoch` but no such column exists
- **THEN** the block is invalid and the diagnostic names `views[0].x`

#### Scenario: Close values are readable
- **GIVEN** a `line` view whose `y` values are `0.061`, `0.064`, `0.087`
- **WHEN** the block renders without `y_from_zero`
- **THEN** the y axis lower bound is not zero and the three points spread across the plot height

#### Scenario: Zero anchor on request
- **WHEN** the same view sets `y_from_zero: true`
- **THEN** the y axis starts at zero

#### Scenario: Numeric steps are to scale
- **GIVEN** a `line` view with `x` cells `1000`, `2000`, `10000`
- **WHEN** the block renders
- **THEN** the x axis is numeric and the gap between `2000` and `10000` is wider than between `1000` and `2000`

#### Scenario: Tooltip shows the declared number
- **GIVEN** a data row whose `y` cell is `0.0612345678`
- **WHEN** the reader hovers that point
- **THEN** the tooltip shows `0.0612345678`, not `0.061`

#### Scenario: Measured points are marked
- **GIVEN** a `line` view with three rows
- **WHEN** the block renders
- **THEN** three point markers are drawn on the line, one per row

#### Scenario: Scatter keeps every row
- **GIVEN** columns `[lr, fid, run]` with rows `[0.001, 14.1, a]`, `[0.001, 15.0, b]`, `[0.002, 13.2, a]` and a `scatter` view with `x: lr`, `y: fid`, `series: run`
- **WHEN** the block renders
- **THEN** three dots are drawn on numeric axes, two sharing `x = 0.001`, coloured by run `a` and `b`

#### Scenario: Scatter skips non-numeric x
- **GIVEN** a `scatter` view where one row's `x` cell is `n/a`
- **WHEN** the block renders
- **THEN** that row is not plotted and the plot states that one row was skipped

#### Scenario: Default filter narrows the table on load
- **GIVEN** a `table` view with `filter_mode: one` and filters `fid < 15` (`where: { fid: { lt: 15 } }`, `default: true`) and `bf16 only` (`where: { run: bf16 }`)
- **WHEN** the block first renders
- **THEN** only rows whose `fid` is below 15 are shown, the `fid < 15` chip is active, and the table states how many of the total rows are shown

#### Scenario: One mode switches and clears
- **GIVEN** the same view with `fid < 15` active
- **WHEN** the reader chooses `bf16 only`, then chooses `All`
- **THEN** first only `bf16` rows are shown with `fid < 15` inactive, then every row is shown

#### Scenario: Any mode combines active filters
- **GIVEN** a `table` view with default `filter_mode` and filters `fid < 15` and `bf16 only`, none default
- **WHEN** the reader turns on both chips
- **THEN** only `bf16` rows whose `fid` is below 15 are shown; turning both off shows every row

#### Scenario: No row matches
- **WHEN** the active filters match no row
- **THEN** the table states that no rows match instead of rendering an empty body

#### Scenario: Invalid filter declaration
- **WHEN** a `table` view's filter `where` names column `epoch` that does not exist
- **THEN** the block is invalid, stays verbatim, and the diagnostic names that filter's `where.epoch` path

#### Scenario: Two defaults in one mode
- **WHEN** a `table` view with `filter_mode: one` marks two filters `default: true`
- **THEN** the block is invalid and reports `WIKI_COMPONENT_INVALID`

#### Scenario: Existing blocks are unchanged
- **GIVEN** a `datatable@1` block written before this change, with `table`, `line`, and `bar` views only
- **WHEN** it is rendered after this change
- **THEN** it validates, keeps its `@1` pin, and renders the same table and plots with no filter chips
