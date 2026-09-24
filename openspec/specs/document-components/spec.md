# document-components Specification

## Purpose

TBD

## Requirements

### Requirement: A component block is a fenced block with `<lang> <type>@<N> #<id>`

A component block SHALL be a fenced code block whose info string is `<lang> <type>@<N>` optionally followed by `#<id>` and nothing else. `<lang>` is any language token; `<type>` SHALL match `^[a-z][a-z0-9-]*$`; `<N>` SHALL be a positive integer major version; `<id>` SHALL match `^[A-Za-z0-9_]+$` and SHALL be unique among the component blocks of one document (`COMPONENT_ID_DUPLICATE`, error). A fenced block whose second token does not have the `<type>@<N>` shape SHALL be an ordinary code block. A block that omits `@<N>` SHALL resolve to the highest registered version of the type and report `WIKI_COMPONENT_UNPINNED` (warn). A block whose type is unregistered, whose pinned version is unregistered, or whose info string carries extra tokens SHALL render as an ordinary code block and report `WIKI_COMPONENT_INVALID` (error) on wiki surfaces.

#### Scenario: Static YAML block
- **WHEN** a document contains `` ```yaml datatable@1 #fid `` with a valid payload
- **THEN** it renders the `datatable` component version 1 and the block is addressable as `fid`

#### Scenario: Plain code block is untouched
- **WHEN** a document contains `` ```yaml `` or `` ```yaml title="x" `` without a `<type>@<N>` token
- **THEN** it renders as an ordinary highlighted code block with no diagnostic

#### Scenario: Attributes are rejected
- **WHEN** a block's info string is `yaml datatable@1 #fid title="x"`
- **THEN** the block is invalid, stays verbatim, and reports `WIKI_COMPONENT_INVALID`

### Requirement: Every payload form becomes one object

The payload object SHALL be derived from the block as follows: `yaml` → parsed with the core YAML schema (anchors and aliases rejected, duplicate keys rejected), and the result SHALL be a mapping; `json` → parsed as JSON, and the result SHALL be an object; any other `<lang>` → `{ "data": "<block body verbatim>" }`. A YAML payload carrying the reserved key `script` or `code` is an executable payload (see `component-execution`) and its cached result object is used instead. Keys beginning with `__` are reserved for the execution layer and SHALL be stripped before validation. The resulting object SHALL be validated against the type version's schema; a validation failure SHALL render the original block verbatim and report `WIKI_COMPONENT_INVALID` naming the failing field. No component SHALL restrict which `<lang>` may be used.

#### Scenario: Embed from HTML fence
- **WHEN** a block is `` ```html embed@1 #chart `` with an HTML body
- **THEN** the component receives `{ data: "<html body>" }` and renders it

#### Scenario: Embed from an executable payload
- **WHEN** a block is `` ```yaml embed@1 #chart `` whose `code` function returns `{ "data": "<p>hi</p>", "height": 200 }` and the block has been run
- **THEN** the component renders that HTML at that height

#### Scenario: Invalid shape stays readable
- **WHEN** a `` ```yaml datatable@1 `` payload has a row whose length differs from `columns`
- **THEN** the block stays verbatim, the page still renders, and `WIKI_COMPONENT_INVALID` names `data`

### Requirement: One descriptor directory is the single source of truth

Each component version SHALL live at `apps/web/lib/components/<type>/v<N>/` in the central web application only, and SHALL export a descriptor with `type`, `version`, `description`, `useWhen`, `schema` (a zod object schema that is also the source of the field table and the renderer's data type), `example` (a complete block), `invalidExamples` (`{ block, code }` pairs), and `fixtures` (project-relative fixture documents); the React renderer SHALL live beside it and receive `data` typed from `schema` plus a block context (`id`, document identity, resource resolver, executable flag). The registry barrel, the renderer barrel, `@memon/core`'s structural component-name list, and the `memon-components` skill table SHALL be generated from these directories by one script with `--write` and `--check` modes, and the check SHALL fail the skills build when any generated output is stale. Every registered version SHALL keep rendering forever; a pinned version below the latest SHALL render and be marked `outdated` in the wiki `components[]` projection. Backends and the CLI SHALL treat component blocks as opaque code.

#### Scenario: Adding a version touches one directory
- **WHEN** `apps/web/lib/components/figure/v2/` is added and the generator is run with `--write`
- **THEN** the registry, renderer barrel, core name list, and skill table all list `figure@2` without hand edits, and `--check` passes

#### Scenario: Stale generated output fails the check
- **WHEN** a descriptor's `description` changes and the generator is not re-run
- **THEN** `--check` exits non-zero naming the stale file

### Requirement: Components render on every Markdown surface

The shared Markdown renderer SHALL resolve component blocks wherever it renders project Markdown (wiki pages, Experiment README sections, Run READMEs, code reviews, Reports) so a block renders identically regardless of the containing document. Document-relative paths in a payload (figure `image`, cache files) SHALL resolve against the containing document's path through the document asset route; a surface without a known document path SHALL render the block's readable fallback (caption/description or verbatim data) without failing the page. Only wiki surfaces SHALL expose `components[]` and component diagnostics.

#### Scenario: Same block in a Run README and a wiki page
- **WHEN** an identical `figure@1` block appears in both
- **THEN** both render the image resolved relative to their own document

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

### Requirement: `figure@1` shows a document-relative or absolute image or video

`figure@1` SHALL accept exactly one of `image` or `video` (each a path relative to the containing document, or an absolute path), `caption` (non-empty), optional `description` (used as alt text or the video's accessible description), and, with `video` only, optional `poster` (an image path in the same form). A video SHALL render as a thumbnail with a play control and SHALL NOT download or play the video until the reader activates it: the thumbnail is the `poster` image when given, otherwise a frame the browser reads through ranged metadata requests without fetching the whole file. Activating it SHALL load the video with native controls and start playback. Every referenced file SHALL be served only when its real path is inside a configured project root (`assertWithinProjectRoots`); otherwise, or on load failure, the block SHALL render the caption and description with a readable notice instead of the media.

#### Scenario: Image beside the page
- **WHEN** `docs/wiki/note/W0009-gallery.md` declares `image: W0009-gallery__assets/pipeline.svg`
- **THEN** the image is served from that directory and the caption renders below it

#### Scenario: Escaping path is refused
- **WHEN** `image: ../../../../etc/hostname` or an absolute path outside every project root is declared
- **THEN** no file is read and the block shows the notice with the caption

#### Scenario: SVG is drawn as an image, never inlined
- **WHEN** `image` names an SVG that contains a `<script>` element
- **THEN** it is displayed through an image element served with a restrictive CSP and the script never executes in the page

#### Scenario: Video waits for the reader
- **GIVEN** `video: W0009-gallery__assets/rollout.mp4` with `poster: W0009-gallery__assets/rollout.jpg`
- **WHEN** the page renders
- **THEN** only the poster image is requested and a play control is shown over it
- **AND** activating the control requests the video and starts playback with native controls

#### Scenario: Image and video together are invalid
- **WHEN** a block declares both `image` and `video`, or `poster` without `video`
- **THEN** the block is invalid with `WIKI_COMPONENT_INVALID` naming the field

### Requirement: `embed@1` renders trusted HTML in an iframe

`embed@1` SHALL accept `data` (HTML string), optional `height` (positive integer pixels or `"auto"`, default `"auto"`), and optional `title`. It SHALL render the HTML in a same-origin `srcdoc` iframe with a `<base href>` pointing at the document's asset route so relative resources resolve, using the existing embed toolbar.

#### Scenario: Height from payload
- **WHEN** `height: 320` is given
- **THEN** the iframe is 320px tall

### Requirement: `checklist@1` keeps its item model under the new declaration

`checklist@1` SHALL keep the recursive `items[]` model and independent flags defined in `wiki-checklist-component`; its declaration SHALL be `` ```yaml checklist@1 #<id> `` (or `json`).

#### Scenario: Static checklist toggles persist
- **WHEN** an owner toggles a flag on a static `checklist@1` block with id `plan`
- **THEN** the block addressed by `plan` is rewritten in place as before
