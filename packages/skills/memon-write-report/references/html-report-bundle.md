# HTML Report bundle contract

The static visualization container produced by `memon-write-report`. Read it
before creating or changing an HTML Report bundle.

## Scope and invariants

An HTML Report bundle is a framework-agnostic static container: hand-written
HTML/CSS/JavaScript, SVG, Canvas, Web Components, or statically built output
from React, Vue, Svelte, Vega, Plotly, or another suitable library. Memon does
not prescribe the framework.

Choose this form only after the user explicitly requests an HTML Report, an
interactive presentation/visualization, or a dashboard. Neither plottable data
nor an installed visualization skill implies that request; ordinary Report
requests stay Markdown.

The bundle must be directly serviceable as static files by memon's Report asset
route: no `npm run dev`, no Vite/Next development mode, no custom application
server, proxy, or server-side rendering to view it.

## Canonical layout and compatibility

```text
docs/reports/R0002-interactive-theme/
├── README.md                     # writer-owned narrative and embeds
├── data/                         # writer-owned normalized evidence
│   ├── metrics.json
│   └── variants.json
├── assets/                       # optional writer-owned shared media
└── views/
    ├── training-curves/          # one isolated view
    │   ├── index.html             # service-ready entry
    │   ├── assets/
    │   └── src/                   # optional regeneration source
    └── variant-table/
        ├── index.html
        └── assets/
```

The writer allocates every Report ID, bundle root, and view slug; prefer one
independently understandable view per `views/<slug>/`.

Preserve old bundles: a top-level `charts.html`, a root `assets/`, or any
previously supported arrangement remains valid, and an update keeps its working
paths unless the user asks for restructuring. Never require migration to
`views/`, a manifest, or new metadata to keep a Report renderable, and never
create a bundle manifest — directory conventions plus root README embeds are the
integration surface.

## Writer ownership

The `memon-write-report` Agent always owns representation selection and the
explicit HTML intent; ID, slug, bundle root and view allocation; root
`README.md` with its frontmatter, narrative, citations and embed order; evidence
selection, interpretation and normalized JSON under `data/`; the boundary
between selected Runs and discarded Attempts; whether to author a view or invoke
an installed skill; integration review, provenance and final validation; and the
user handoff.

Delegation never transfers those. Never ask an external skill to invent
evidence, rewrite Report claims, choose a Report ID, or integrate its own output
into the root README.

## Delegating one view

Once the HTML form is chosen, the writer may invoke any installed
visualization/frontend skill with a bounded handoff:

```yaml
report_root: docs/reports/R0002-interactive-theme
view_slug: training-curves
writable_directory: docs/reports/R0002-interactive-theme/views/training-curves
entrypoint: views/training-curves/index.html
read_only_data:
  - data/metrics.json
task: Compare loss and throughput across selected Variants.
runtime: Static files served from the memon Report asset route; no dev server.
responsive: Support 390px viewport and desktop; touch and keyboard usable.
```

The delegate may write only inside its assigned `views/<slug>/` — never root
`README.md` or frontmatter, `data/`, writer-owned `assets/`, a sibling view, or
project package files, lockfiles, server configuration, or outside source. A
view-local build file, source, or vendored dependency is fine as long as the
service-ready static output stays in that view directory.

Ask the delegate to return the static entrypoint, framework/library and
versions, the skill used, the essential regeneration command, the data files
consumed, and the validation performed with remaining limitations. Afterwards
the writer inspects every changed path, serves the output, adds the README
embed, writes provenance, and validates itself — delegate-reported success is
not verification.

## Static runtime and relative URLs

`views/<slug>/index.html` must be ready for direct HTTP serving. A build step
may regenerate it, but never be required to view the committed Report.

Use relative URLs for local files, resolved from the referencing file:

```js
const metrics = await fetch('../../data/metrics.json').then((response) => {
  if (!response.ok) throw new Error(`metrics: ${response.status}`)
  return response.json()
})
```

`../` segments are acceptable only while the normalized target stays inside the
Report bundle. Never address arbitrary project or server files, and never use
absolute filesystem paths, `file://`, localhost URLs, or a developer-specific
origin. Configure framework asset bases for relative deployment and verify
nested JS, CSS, fonts, images, source maps, and dynamic imports through the real
asset route. Third-party HTTPS CDN assets are allowed if the view degrades to a
comprehensible loading/error/fallback state when they fail.

## Data boundary

The writer extracts and normalizes display data. Prefer JSON under `data/` over
large literals in HTML/JS, and keep the source IDs and provenance fields that
let a user trace a value back to Experiments, Variants, Runs, W&B, or artifacts.

`data/` is read-only input to a delegate: a needed derived field or schema change
is proposed to the writer, which updates the JSON. A visualization never
silently redefines facts or keeps a second canonical dataset in its JavaScript.

Never put credentials, tokens, private environment values, or other secrets into
JSON, HTML, CSS, JavaScript, URLs, or browser-visible metadata.

## Responsive and touch requirements

Every new or materially changed view works from a 390 CSS-pixel viewport through
a representative desktop width, and declares:

```html
<meta name="viewport" content="width=device-width, initial-scale=1">
```

- fit primary content to the width without page-level horizontal overflow;
- resize charts and controls with their container, not a fixed desktop canvas;
- keep text legible and controls usable at 390 px without zoom;
- scroll a wide table inside a bounded region rather than widening the page;
- support touch with adequately sized targets, ideally ≥44 CSS px for primary
  controls;
- give tap/click/focus or persistent alternatives to anything shown on hover;
- retain visible focus and keyboard operation;
- never hide essential information inside a fixed-height region with no way to
  reach it.

Test at least 390 px and one desktop width such as 1280 px, exercising the real
filters, selectors, table scrolling, tooltips, and links. A screenshot does not
validate interaction.

## Iframe embedding and trust

Image-form Markdown in root `README.md` embeds a local HTML entry; link-form
navigates:

```markdown
![Training curves](./views/training-curves/index.html)
[Open training curves](./views/training-curves/index.html)
```

The iframe is intentionally unsandboxed and same-origin, with JavaScript and CDN
access allowed — never claim the view is isolated from memon APIs or browser
state, and review dependencies and generated code accordingly.

Do not introduce an iframe auto-height protocol: no `postMessage` resize
handshake, no manifest height. Design the view to behave responsively inside the
iframe viewport and scroll internally when content legitimately exceeds it.

## Provenance and regeneration

Record in root `README.md` — prose or a compact table under a heading such as
`## Visualization provenance`, never a manifest — for each view: path and
purpose; framework/library and version, or `vanilla`; the skill used, or `none`;
writer-owned JSON inputs; the essential regeneration command, or `not required`;
material CDN dependencies and any offline limitation. Keep commands
project-relative, and correct stale entries while preserving valid ones.

## Validation checklist

- [ ] The user explicitly requested HTML, interactive output, or a dashboard.
- [ ] Root frontmatter parses and its ID matches the bundle path.
- [ ] `README.md` remains writer-authored and cites the underlying evidence.
- [ ] Every delegated change is confined to its assigned `views/<slug>/`.
- [ ] Every iframe/link target and local asset resolves inside the bundle.
- [ ] Every entry loads through memon's Report asset route, not `file://`, and
      works without a development or application server.
- [ ] JSON fetches, MIME types, dynamic imports, and CDN failure states work.
- [ ] No local URL depends on an absolute path, localhost, or one machine.
- [ ] No secret is browser-visible.
- [ ] The iframe syntax is intentional; no sandbox or auto-height claim.
- [ ] Framework, skill, data inputs, and regeneration essentials are recorded.
- [ ] The view is readable and operable at 390 px and desktop width, wide tables
      scroll locally, and touch/focus/non-hover paths reach every essential
      interaction.
- [ ] Existing bundle paths out of scope remain compatible.

## Fallback behavior

An external visualization skill is an optional aid, not a dependency. If it is
unavailable, unsuitable, or fails: preserve the writer-owned README, data, and
allocation; try another installed skill only when it clearly fits; otherwise
author a smaller vanilla static view; keep the requested evidence and essential
interaction while simplifying decoration; and report the limitations and the
attempted workaround.

Never answer an explicit HTML request with a Markdown-only Report. If no safe
static HTML result is possible, leave existing Reports intact and give a blocked
handoff naming the missing capability and the next action.
