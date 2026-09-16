---
name: memon-components
description: "Write component blocks inside memon Markdown — wiki pages, Experiment READMEs, Run records, code reviews, and Reports. Use when a section needs a data table with charts, a captioned image, an embedded HTML view, or a recursive checklist, and you need the declaration syntax, the static and executable payload forms, and the field reference."
---

# memon-components

The only skill that describes how to author component blocks. Other memon
skills route here instead of restating these rules.

A component is a fenced code block that the dashboard renders as a real widget
instead of highlighted source. The renderer is shared by every Markdown surface
memon renders, so the same block works in a wiki page, an Experiment README, a
Run record, a code review, and a Report. A fence that does not declare a
registered component is an ordinary code block — no diagnostic, no rendering,
no harm.

Follow `../PREFLIGHT.md` for every `memon` command used here.

## When to use

- Numbers a reader should be able to re-derive, or compare across runs in a
  table, line chart, or bar chart.
- A captioned image with a description an agent can read without opening the file.
- A self-contained interactive HTML view inside otherwise ordinary Markdown.
- A recursive task list whose Agent and human flags must stay independent.

## When NOT to use

- Ordinary prose, lists, links, and small Markdown tables. **Plain Markdown is
  the default and right answer for most sections.**
- Callouts: GitHub alert blockquotes (`> [!NOTE]`, `> [!WARNING]`,
  `> [!DEPRECATED]`, …) already render as styled callouts.
- Page-level HTML in a wiki bundle (`entry:` frontmatter) — that is the wiki
  bundle contract, not a component.
- Adding, changing, or versioning a component type: that is a harness change in
  the memon repo. Surface the need instead (last section).

Do not ask the user which component to use and do not show a draft block for
approval: pick the one matching the content, write it, and let lint and the
rendered page be the feedback loop.

## The declaration

A component block's info string is exactly `<lang> <type>@<N>`, optionally
followed by `#<id>`:

````markdown
```yaml datatable@1 #fid
columns: [step, fid]
data:
  - [20000, 12.4]
  - [40000, 9.8]
```
````

- **`<lang>`** is the *payload* language, not the component. `yaml` and `json`
  parse the body into an object; any other language hands the component
  `{ data: "<body verbatim>" }`.
- **`<type>@<N>`** names the component and pins its major version. Always pin.
  An unpinned block resolves to the highest registered version but lints
  `WIKI_COMPONENT_UNPINNED` and silently changes meaning when a new major ships.
- **`#<id>`** matches `^[A-Za-z0-9_]+$` and must be unique among the component
  blocks of one document (`COMPONENT_ID_DUPLICATE` otherwise). It is required
  for an executable payload, because the id names its cache file; it is optional
  for a static block, and worth adding whenever a human or a command may need to
  address that block later.
- **Nothing else.** There are no info-string attributes: every option lives in
  the payload. `yaml datatable@1 #fid title="x"` lints `WIKI_COMPONENT_INVALID`
  and stays verbatim.
- A fence whose second token is not of the `<type>@<N>` shape, or whose type or
  pinned version is not registered, renders as an ordinary code block.

An invalid block never breaks the page: it stays readable as source and reports
a diagnostic.

## Static payloads

The whole payload is one object.

- `yaml` — parsed with the core YAML schema. Anchors and aliases are rejected,
  duplicate keys are rejected, and the result must be a mapping.
- `json` — parsed as JSON; the result must be an object.
- any other language — the component receives `{ data: "<body verbatim>" }`.
  This is how `html embed@1` works: write the HTML, get it rendered.

Keys beginning with `__` belong to the execution layer and are stripped before
validation; never write one by hand.

## Executable payloads

A `yaml` payload carrying exactly one of the reserved top-level keys `script` or
`code` is *executable*: the object the component receives is the return value of
a Python function, cached beside the document.

````markdown
```yaml datatable@1 #fid
code: |
  import csv, os

  def collect(source, **kw):
      path = os.path.join(os.path.dirname(kw["__md_file_path"]), source)
      with open(path, newline="") as handle:
          rows = list(csv.reader(handle))
      return {"columns": rows[0], "data": [[r[0], float(r[1])] for r in rows[1:]]}
source: data/fid.csv
```
````

- **`script: <path>::<function>`** — path relative to the containing document,
  or absolute inside a configured project root; `<function>` is a Python
  identifier in that module.
- **`code: |`** — a block scalar containing exactly one top-level `def`. Zero or
  several top-level `def`s is `WIKI_COMPONENT_INVALID`.
- Both keys at once, a malformed reference, or a path outside every project root
  is `WIKI_COMPONENT_INVALID`.
- **Every other top-level key is passed as a keyword argument**, so the payload
  is both the call site and the documentation of the call.
- Four keys are injected on every call: `__id`, `__md_file_path` (the
  project-relative document path), `__project_root`, and `__assets_dir` (the
  project-relative cache directory). Accept them with `**kw` unless you need one
  by name.
- The function **must return a JSON-serialisable object** (a `dict`). A list, a
  scalar, or a raised exception is a failed run.
- The process runs with the **project root as its working directory**, so
  project-relative paths work directly; use `__md_file_path` when you want a
  path relative to the document instead.
- An executable block **needs `#<id>`** (`WIKI_COMPONENT_INVALID` without one).

### Inline by default

Write `code:` inline. The payload, the call, and the rendered result then live in
one diffable block, and a reader sees where the numbers came from without opening
another file.

Extract a `.py` into the project's `scripts/` and reference it with `script:`
only when one of these is true:

- the same function is used by another block or another document, or
- the body is unusually long (roughly beyond 40 lines) or needs its own imports,
  helpers, and tests.

Collector scripts live in the project's `scripts/`, never inside `docs/`, and
are committed separately from the page.

## The cache beside the document

An executable block's result is cached next to its document, in a directory
named after the document's stem:

| document | cache file for `#fid` |
| --- | --- |
| `docs/wiki/note/W0004-x.md` | `docs/wiki/note/W0004-x__assets/fid.json` |
| `docs/wiki/note/W0004-x/README.md` | `docs/wiki/note/W0004-x/README__assets/fid.json` |

The file holds the returned object at the top level plus hidden bookkeeping
keys: `__md_file_path`, `__component_type`, `__component_id`, `__updated_at`,
`__source_hash`, `__duration_ms`, and — only after a failed run —
`__last_error: { at, message }`.

- A failed run **keeps the previous data** and records `__last_error`; the page
  keeps rendering the last good result with the error visible.
- A cache file whose `__component_id` or `__component_type` disagrees with the
  block is ignored and reported.
- With no cache file at all the block renders a "not computed" notice naming the
  command to run.
- **Commit the `__assets` directory together with the page.** The cached result
  is what every reader without a Python runtime sees. `memon wiki commit` stages
  it; wiki discovery ignores `*__assets` directories as pages.
- Never hand-edit a cache file and never hand-write one to make a page look
  computed.

## Recompute is explicit

Nothing recomputes on render. Ask for it:

```sh
memon --project-root . components run docs/wiki/note/W0004-x.md
memon --project-root . components run docs/wiki/note/W0004-x.md --id fid --id losses
```

`--id` is repeatable; without it every executable block of the document runs.
It prints one JSON result per block — `updated`, `unchanged`, or `failed` — and
exits non-zero when any block failed. Owners can press the recompute button on
an executable block on any dashboard surface that knows the document path; it
reports the same three outcomes.

**Report only results you actually produced.** Run the block in this task before
claiming its numbers are current, read the output, and say so plainly when a run
failed or when you are looking at a cached result from an earlier run. A table
whose numbers were never produced by its own function is a fabricated table.

## Checklist flags are a human boundary

`checklist@1` carries three independent flags per item: `agent_completed`,
`human_acknowledged`, and `human_reviewed`. They never aggregate and never
cascade between parent and child.

- Set `agent_completed` **only** after completing that item's own work.
- **Never** set or clear `human_acknowledged` or `human_reviewed` unless the user
  explicitly authorizes that operation for those specific items. "Looks fine,
  mark it" for one item authorizes that one item and that one flag.
- Update only the selected item's selected flag, including when clearing it.
- These flags are separate from wiki commit review and never create or remove a
  wiki review mark.

Filesystem access cannot authenticate a human behind a direct YAML edit, so this
is a documented agent boundary, not an enforced one. Respect it anyway.

## Verify what you wrote

```sh
memon --project-root . wiki lint --strict
```

Read the diagnostics, not just the exit code. Then, whenever a dashboard is
reachable, open the page and look at it: a block can lint clean and still render
as an empty table, an unreadable overflow, or a blank iframe. Fix what you see
before handing off.

## When nothing fits

Do not force the closest component and do not invent a type name.

1. Write an `embed@1` block — static HTML for a self-contained fragment, or an
   executable payload returning `data` when the HTML has to be built from
   project files. In a wiki bundle, a `views/<slug>/index.html` referenced by
   frontmatter `entry` is the page-level alternative.
2. Say in the surrounding prose that this is hand-written HTML and why.
3. Create a `harness-feedback` page proposing the component:

   ```sh
   memon --project-root . wiki create harness-feedback interactive-3d-plot-component \
     --title "Wiki needs an interactive 3-D plot component" \
     --description "Rotatable 3-D scatter plots are hand-written HTML in every page that needs one." \
     --status PROPOSED
   ```

   `Motivation` names the page and the moment the gap hurt; `Proposal` names the
   smallest component that would close it. Leave the status `PROPOSED` —
   accepting it is a human decision and shipping it is a harness change.

## Guardrails

- Never write an unpinned component declaration.
- Never put attributes in the info string.
- Never give two component blocks in one document the same id.
- Never hand-write or hand-edit a cache file under `*__assets/`.
- Never present a cached result as freshly computed without having run it.
- Never touch a human checklist flag without explicit per-item authorization.
- Never add, edit, or version a component type from a project working tree.
- Never ask the user to choose the component or approve a draft block.

## Registered components

Field tables below are generated from the component descriptors; they are the
contract. Copy an example and edit it rather than inventing fields.

<!-- component-table:start -->
<!-- Generated by scripts/component-docs.ts — do not edit. -->

| type | version | description | use when |
| --- | --- | --- | --- |
| `checklist` | 1 | A recursive task list with independent Agent-completed, human-acknowledged, and human-reviewed flags. | Use for work plans, review gates, and hand-offs where the human must distinguish Agent completion from their own acknowledgement and review. Agents set `agent_completed` only after doing the work and never set either human-owned flag without an explicit request. Do not infer a parent state from its children. |
| `datatable` | 1 | A table of measured values, optionally plotted as line or bar views of the same rows. | Use it whenever a document states more than two or three numbers: metrics per step, per configuration, or per host. Write the numbers you actually measured — one row per observation, long format (`run, step, metric, value`) rather than one column per run — and add a `line`/`bar` view when the shape of the numbers is the point. Use an executable payload (`script:`/`code:`) when the numbers come from logs that change; keep the block static when they are final. Do not use it for prose comparisons (plain Markdown), for an interactive plot (`embed@1`), or for a picture of a plot (`figure@1`). |
| `embed` | 1 | Trusted HTML rendered in a same-origin iframe with the shared report toolbar. | Use for an interactive chart or self-contained HTML view. Put `title`/`height` in a YAML payload when they matter, or use an `html embed@1` fence for the simplest `{data}` form. Use `figure@1` for a static image and `datatable@1` when the source numbers should remain directly readable. |
| `figure` | 1 | A document-relative image with a visible caption and agent-readable description. | Use for a local image or plot snapshot that needs a durable visible caption. Keep the image beside the document (usually in its `<stem>__assets` directory), describe what the pixels show, and use `embed@1` instead when interaction matters. |

### checklist@1

| field | type | required | meaning |
| --- | --- | --- | --- |
| `items` | array of object \| null | yes | Recursive checklist items in display order. Each item has a non-empty `title`, optional plain-text `content`, optional `children`, and independent boolean `status.agent_completed`, `status.human_acknowledged`, and `status.human_reviewed` flags (all default false). |
| `items.title` | string | yes | One-line item label. |
| `items.content` | string \| null | no | Optional plain-text detail shown when the item is expanded. |
| `items.status` | object \| null | no | Three independent status flags; omitted flags default to false. |
| `items.status.agent_completed` | boolean | no | Agent-owned claim that this item is complete; independent of both human flags. |
| `items.status.human_acknowledged` | boolean | no | Human-owned acknowledgement that the item has been seen; never inferred or set by the Agent unprompted. |
| `items.status.human_reviewed` | boolean | no | Human-owned confirmation that the work was reviewed; independent of acknowledgement and completion. |
| `items.children` | array of object \| null | no | Nested items in display order; state never cascades between parent and child. |

````markdown
```yaml checklist@1 #release_gate
items:
  - title: Collect baseline measurements
    status:
      agent_completed: true
    children:
      - title: Host A
        status:
          human_acknowledged: true
  - title: Write up the comparison
```
````

### datatable@1

| field | type | required | meaning |
| --- | --- | --- | --- |
| `columns` | array of string | yes | Column names in order; non-empty and unique. Views address columns by these names. |
| `data` | array of array of unknown | yes | Rows in display order; every row has exactly one cell per column. Cells may be strings, numbers, booleans, or null. |
| `title` | string | no | Short caption shown above the data. |
| `note` | string | no | One or two sentences of context shown under the title, e.g. how the numbers were produced. |
| `views` | array of object | no | How to show the data, in switcher order. `table` needs nothing else; `line` and `bar` need `x` and `y` column names and accept `series` (one line/bar group per distinct value), `tabs` (outer tab strip), and `select` (inner dropdown). The four roles must name four different existing columns. |

````markdown
```yaml datatable@1 #fid_by_step
title: FID by training step
note: Lower is better. Both runs use the same evaluation seed.
columns: [run, step, fid]
data:
  - [baseline, 10000, 18.4]
  - [baseline, 20000, 14.1]
  - [bf16, 10000, 18.9]
  - [bf16, 20000, 13.2]
views:
  - type: table
  - type: line
    x: step
    y: fid
    series: run
```
````

### embed@1

| field | type | required | meaning |
| --- | --- | --- | --- |
| `data` | string | yes | Trusted HTML document or fragment rendered in a same-origin iframe. |
| `height` | number \| "auto" | no | Iframe height in positive integer pixels, or `auto` to measure its content. |
| `title` | string | no | Accessible title shown in the embed toolbar and used for the iframe. |

````markdown
```html embed@1 #interactive_chart
<!doctype html>
<title>Training loss</title>
<p>Interactive chart</p>
```
````

### figure@1

| field | type | required | meaning |
| --- | --- | --- | --- |
| `image` | string | yes | Image path relative to the containing Markdown document, or an absolute path inside the project root. |
| `caption` | string | yes | Visible caption displayed below the image. |
| `description` | string | no | Image alternative text and readable fallback detail; defaults to the caption. |

````markdown
```yaml figure@1 #pipeline
image: W0009-figure-gallery__assets/pipeline.svg
caption: Figure 1. A three-stage processing pipeline.
description: Input, Process, and Output boxes connected from left to right.
```
````

<!-- component-table:end -->
