# HTML Report bundle contract

This reference defines the static visualization container produced by
`memon-write-report`. Read it completely before creating or changing an HTML
Report bundle.

## Contents

- [Scope and invariants](#scope-and-invariants)
- [Canonical layout and compatibility](#canonical-layout-and-compatibility)
- [Writer ownership](#writer-ownership)
- [Delegating one view](#delegating-one-view)
- [Static runtime and relative URLs](#static-runtime-and-relative-urls)
- [Data boundary](#data-boundary)
- [Responsive and touch requirements](#responsive-and-touch-requirements)
- [Iframe embedding and trust](#iframe-embedding-and-trust)
- [Provenance and regeneration](#provenance-and-regeneration)
- [Validation checklist](#validation-checklist)
- [Fallback behavior](#fallback-behavior)

## Scope and invariants

Treat an HTML Report bundle as a framework-agnostic static visualization
container. It may contain hand-written HTML/CSS/JavaScript, SVG, Canvas, Web
Components, or statically built output from React, Vue, Svelte, Vega, Plotly,
or another suitable library. Memon does not prescribe the framework.

Choose this form only after the user explicitly requests one of:

- an HTML Report;
- an interactive presentation or visualization;
- a dashboard.

Do not infer that request merely because data could be plotted or because an
installed visualization/frontend skill is available. Ordinary Report requests
remain Markdown by default.

The bundle must be directly serviceable as static files by memon's Report asset
route. Viewing it must not require `npm run dev`, Vite/Next development mode, a
custom application server, a proxy process, or framework-specific server-side
rendering.

## Canonical layout and compatibility

Use this layout for a new bundle:

```text
docs/reports/R0002-interactive-theme/
├── README.md                     # writer-owned narrative and embeds
├── data/                         # writer-owned normalized evidence
│   ├── metrics.json
│   └── variants.json
├── assets/                       # optional writer-owned shared media
│   └── overview.png
└── views/
    ├── training-curves/          # one isolated view
    │   ├── index.html             # service-ready entry
    │   ├── assets/
    │   └── src/                   # optional regeneration source
    └── variant-table/
        ├── index.html
        └── assets/
```

Let the Report writer allocate every Report ID, bundle root, and unique view
slug. Prefer one independently understandable view per `views/<slug>/`.

Preserve old bundles. A top-level `charts.html`, root `assets/`, or another
previously supported arrangement remains valid. When updating an old bundle,
keep its working paths unless the user explicitly requests restructuring. Do
not require migration to `views/`, a manifest, or new metadata merely to keep
the Report renderable.

Do not create or require a bundle manifest. Directory conventions and root
README embeds are the integration surface.

## Writer ownership

The `memon-write-report` Agent always owns:

- representation selection and confirmation of the explicit HTML intent;
- Report ID, slug, bundle root, and view-directory allocation;
- root `README.md`, its frontmatter, narrative, citations, and embed order;
- evidence selection, interpretation, and normalized JSON under `data/`;
- the boundary between selected Runs and discarded Attempts;
- the choice to author a view or invoke an installed visualization/frontend
  skill;
- integration review, provenance notes, and final validation;
- the final user handoff.

Delegation never transfers those responsibilities. Do not ask an external skill
to invent evidence, rewrite Report claims, choose a Report ID, or integrate its
own output into the root README.

## Delegating one view

The writer may autonomously choose and invoke any installed visualization or
frontend skill that suits the requested view. Do so only after the HTML bundle
form has already been selected under the explicit-request rule.

Give the delegated skill a bounded handoff containing:

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

Enforce a single write capability: the delegated skill may write only inside
the assigned `views/<slug>/` directory. It must not modify:

- root `README.md` or Report frontmatter;
- `data/` or writer-owned `assets/`;
- any sibling view;
- project package files, lockfiles, server configuration, or source outside the
  assigned directory.

A view may contain a view-local build file, source, or vendored dependency when
needed, but its checked-in/service-ready static output must also remain inside
that same view directory. Ask the delegate to return:

- the static entrypoint;
- framework/library and important versions, when known;
- the installed skill used;
- the exact essential regeneration/build command;
- data files consumed;
- validation performed and remaining limitations.

After delegation, the writer must inspect all changed paths, serve the output,
add the root README embed, write provenance, and run final validation itself.
Delegate-reported success is not final verification.

## Static runtime and relative URLs

Require `views/<slug>/index.html` to be ready for direct HTTP serving. A build
step may be needed to regenerate it, but not to view the committed Report.

Use relative URLs for all local files. Resolve them from the file that contains
the reference. For example, a view entry may load writer-owned data with:

```js
const metrics = await fetch('../../data/metrics.json').then((response) => {
  if (!response.ok) throw new Error(`metrics: ${response.status}`)
  return response.json()
})
```

`../` segments are acceptable only when their normalized target remains inside
the same Report bundle. Never address arbitrary project or server files. Do not
use absolute filesystem paths, `file://`, localhost development URLs, or a
developer-specific origin.

Configure framework asset bases for relative deployment. Verify nested JS,
CSS, fonts, images, source maps if shipped, and dynamic imports through the
actual Report asset route. Third-party HTTPS CDN assets remain allowed, but the
view must show a comprehensible loading/error or fallback state if they fail.

## Data boundary

The Report writer extracts and normalizes display data. Prefer JSON files under
`data/` over large literals embedded in HTML or JavaScript. Keep source IDs and
provenance fields that let a user trace values back to Experiments, Variants,
Runs, W&B, or artifacts.

Treat `data/` as read-only input to delegated skills. If a view needs a derived
field or changed schema, the delegate proposes it and the writer updates the
JSON. Do not let the visualization silently redefine facts or duplicate a
second canonical dataset inside its JavaScript.

Do not put credentials, auth tokens, private environment values, or other
secrets into JSON, HTML, CSS, JavaScript, URLs, or browser-visible metadata.

## Responsive and touch requirements

Every new or materially changed view must work from a 390 CSS-pixel-wide
viewport through a representative desktop width.

Include a viewport declaration:

```html
<meta name="viewport" content="width=device-width, initial-scale=1">
```

Require the following behavior:

- fit primary content to the available width without page-level horizontal
  overflow;
- make charts and controls resize with their container rather than assuming a
  fixed desktop canvas;
- keep text legible and controls usable at 390 px without browser zoom;
- make wide tables scroll horizontally inside a bounded table region instead
  of widening the entire iframe/page;
- support touch input and adequately sized targets; prefer at least 44 CSS
  pixels for primary interactive controls where practical;
- provide tap, click, focus, or persistent alternatives for information that
  appears on hover; never make hover the only way to operate a control or read
  essential values;
- retain visible focus and keyboard operation for applicable controls;
- avoid placing essential information outside a fixed-height region with no
  internal way to reach it.

Test at minimum a 390 px viewport and one desktop viewport such as 1280 px.
Exercise the actual filters, selectors, table scrolling, tooltips/details, and
links with narrow and desktop layouts. A screenshot alone does not validate
interaction.

## Iframe embedding and trust

Embed a local HTML entry from root `README.md` with image-form Markdown:

```markdown
![Training curves](./views/training-curves/index.html)
```

Use normal link-form Markdown when navigation, rather than inline embedding, is
intended:

```markdown
[Open training curves](./views/training-curves/index.html)
```

The iframe remains intentionally unsandboxed and same-origin. JavaScript and
CDN access are allowed. Do not claim that the view is isolated from memon APIs
or browser state. Review dependencies and generated code accordingly.

Do not introduce an iframe auto-height protocol. There is no required
`postMessage` resize handshake or manifest-provided height. Design the view to
behave responsively within the iframe viewport and provide internal scrolling
when content legitimately exceeds the available area.

## Provenance and regeneration

Record enough information in the root `README.md` for another Agent to maintain
each view. Use prose or a compact table under a heading such as
`## Visualization provenance`; do not create a manifest.

For each view record:

- view path and purpose;
- framework/library and important version, or `vanilla`;
- visualization/frontend skill used, or `none`;
- writer-owned JSON inputs;
- essential regeneration/build command, or `not required`;
- material CDN dependencies and any known offline limitation.

Keep commands project-relative and avoid host-specific absolute paths. When a
view is updated, preserve still-valid provenance and correct stale entries.

## Validation checklist

Before handoff, the Report writer verifies:

- [ ] The user explicitly requested HTML, interactive output, or a dashboard.
- [ ] Root frontmatter parses and its ID matches the bundle path.
- [ ] `README.md` remains writer-authored and cites the underlying evidence.
- [ ] Every delegated change is confined to its assigned `views/<slug>/`.
- [ ] Every iframe/link target and local asset resolves inside the bundle.
- [ ] Every entry loads through memon's Report asset route, not `file://`.
- [ ] Static content works without a development or application server.
- [ ] JSON fetches, MIME types, dynamic imports, and CDN failure states work.
- [ ] No local URL depends on an absolute path, localhost, or one machine.
- [ ] No secret is browser-visible.
- [ ] The iframe syntax is intentional and no sandbox/auto-height claim was
  introduced.
- [ ] Framework, skill, data inputs, and regeneration essentials are recorded.
- [ ] The view is readable and operable at 390 px and desktop width.
- [ ] Wide tables scroll locally; the overall page does not overflow.
- [ ] Touch, focus, and non-hover paths reach all essential interactions.
- [ ] Existing bundle paths not in scope remain compatible.

## Fallback behavior

Treat an external visualization/frontend skill as an optional implementation
aid, not a Report dependency. If it is unavailable, unsuitable, or fails:

1. preserve the writer-owned README, data, and directory allocation;
2. try another installed skill only when it clearly fits;
3. otherwise author a smaller vanilla static HTML/CSS/JavaScript view;
4. preserve the requested evidence and essential interaction, while simplifying
   decoration or advanced controls when necessary;
5. report material limitations and the attempted workaround.

Do not respond to an explicit HTML request with only a Markdown Report. If no
safe static HTML result can be produced, leave existing Reports intact and give
a blocked handoff explaining the missing capability and next action.
