## Purpose

Defines how a Markdown document declares a component block, how the block's payload becomes the one object a component receives, how the central dashboard registers, validates, renders, and documents component types and versions, and the schemas of the shipped `datatable`, `figure`, `embed`, and `checklist` components.

## ADDED Requirements

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

`datatable@1` SHALL accept `columns: string[]` (non-empty, unique), `data: unknown[][]` (every row exactly `columns.length` long), optional `title`, optional `note`, and `views: View[]` (default `[{ type: "table" }]`, at least one). `View.type` SHALL be `table`, `line`, or `bar`. `line` and `bar` SHALL require `x` and `y` (column names) and accept optional `series`, `tabs`, and `select` column names; every named column SHALL exist and the four roles SHALL be distinct. Rendering SHALL show a view switcher when more than one view exists; `table` SHALL render a horizontally scrollable table; `line`/`bar` SHALL plot `y` against `x`, drawing one series per distinct `series` value (in first-appearance order) or a single series when absent; `tabs` SHALL render a tab per distinct value (outer), `select` a dropdown per distinct value (inner, scoped to the current tab), both optional and orthogonal, both in first-appearance order, and the plotted rows SHALL be those matching the current tab and selection. Values that are not numbers on `y` SHALL be skipped and the plot SHALL state how many rows were skipped. Schema violations SHALL be reported as `WIKI_COMPONENT_INVALID` and the block SHALL stay verbatim.

#### Scenario: Two experiments, two metrics, several runs
- **GIVEN** columns `[experiment, metric, run, step, value]` and a `line` view with `x: step`, `y: value`, `series: run`, `tabs: experiment`, `select: metric`
- **WHEN** the reader picks tab `E0021` and metric `fid`
- **THEN** one line per run of `E0021` with metric `fid` is drawn, and switching the tab resets the dropdown to that tab's first metric

#### Scenario: Invalid view column
- **WHEN** a view names `x: epoch` but no such column exists
- **THEN** the block is invalid and the diagnostic names `views[0].x`

### Requirement: `figure@1` shows a document-relative or absolute image

`figure@1` SHALL accept `image` (a path relative to the containing document, or an absolute path), `caption` (non-empty), and optional `description` (used as alt text). The image SHALL be served only when its real path is inside a configured project root (`assertWithinProjectRoots`); otherwise, or on load failure, the block SHALL render the caption and description with a readable notice instead of an image.

#### Scenario: Image beside the page
- **WHEN** `docs/wiki/note/W0009-gallery.md` declares `image: W0009-gallery__assets/pipeline.svg`
- **THEN** the image is served from that directory and the caption renders below it

#### Scenario: Escaping path is refused
- **WHEN** `image: ../../../../etc/hostname` or an absolute path outside every project root is declared
- **THEN** no file is read and the block shows the notice with the caption

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
