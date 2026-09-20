## MODIFIED Requirements

### Requirement: `datatable@1` shows one dataset through table, line, and bar views

`datatable@1` SHALL accept `columns: string[]` (non-empty, unique), `data: unknown[][]` (every row exactly `columns.length` long), optional `title`, optional `note`, and `views: View[]` (default `[{ type: "table" }]`, at least one). `View.type` SHALL be `table`, `line`, or `bar`. `line` and `bar` SHALL require `x` and `y` (column names) and accept optional `series`, `tabs`, and `select` column names; every named column SHALL exist and the four roles SHALL be distinct. Rendering SHALL show a view switcher when more than one view exists; `table` SHALL render a horizontally scrollable table; `line`/`bar` SHALL plot `y` against `x`, drawing one series per distinct `series` value (in first-appearance order) or a single series when absent; `tabs` SHALL render a tab per distinct value (outer), `select` a dropdown per distinct value (inner, scoped to the current tab), both optional and orthogonal, both in first-appearance order, and the plotted rows SHALL be those matching the current tab and selection. Values that are not numbers on `y` SHALL be skipped and the plot SHALL state how many rows were skipped. Schema violations SHALL be reported as `WIKI_COMPONENT_INVALID` and the block SHALL stay verbatim. Plot views SHALL fit both axes to the plotted values by default: the y domain SHALL span the data rather than start at zero, and a `line` view whose kept `x` cells are all numeric SHALL use a numeric x axis spanning the data (`bar` views keep a categorical x axis). Optional boolean view fields `x_from_zero` and `y_from_zero` SHALL anchor the respective axis at zero. Hover tooltips SHALL print the raw cell text of the hovered `x` and of every plotted `y` value exactly as declared, never a rounded or locale-formatted rendering.

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
