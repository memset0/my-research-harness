# Wiki HTML bundle contract

This reference defines the static visualization container a wiki page may
carry. Read it completely before creating or changing a wiki bundle.

## Contents

- [Scope and invariants](#scope-and-invariants)
- [Canonical layout](#canonical-layout)
- [The three HTML scopes](#the-three-html-scopes)
- [Author ownership](#author-ownership)
- [Delegating one view](#delegating-one-view)
- [Static runtime and relative URLs](#static-runtime-and-relative-urls)
- [Data boundary](#data-boundary)
- [Responsive and touch requirements](#responsive-and-touch-requirements)
- [Embedding and trust](#embedding-and-trust)
- [Provenance and regeneration](#provenance-and-regeneration)
- [Validation checklist](#validation-checklist)
- [Fallback behavior](#fallback-behavior)

## Scope and invariants

A wiki bundle is a framework-agnostic static container. It may hold
hand-written HTML/CSS/JavaScript, SVG, Canvas, Web Components, or statically
built output from React, Vue, Svelte, Vega, Plotly, or another suitable
library. Memon does not prescribe the framework.

Choose the bundle form only when the page genuinely needs shipped assets:

- an interactive explorer or dashboard the user asked for;
- a `showcase` whose artifacts are files rather than prose;
- a data file too large or too shared to inline.

Ordinary pages stay single-file Markdown. `memon wiki create <kind> <slug>
--bundle` allocates the directory form; converting an existing page is a
`move`, not an edit, and is done only on request.

The bundle must be directly serviceable as static files by memon's wiki asset
route. Viewing it must not require `npm run dev`, Vite/Next development mode,
a custom application server, a proxy process, or framework-specific
server-side rendering.

## Canonical layout

```text
docs/wiki/showcase/W0006-precond-explorer/
├── README.md                     # author-owned frontmatter, narrative, embeds
├── data/                         # author-owned normalized evidence
│   ├── metrics.json
│   └── variants.csv
├── assets/                       # optional author-owned shared media
│   └── overview.png
└── views/
    ├── precond-curves/           # one isolated view
    │   ├── index.html             # service-ready entry
    │   ├── assets/
    │   └── src/                   # optional regeneration source
    └── variant-table/
        └── index.html
```

The page's Markdown file is always `README.md` at the bundle root; discovery
never looks deeper for it. Everything else inside the directory is bundle
content served at:

```text
/api/wiki-assets/<project>/<W-id>/<path-inside-the-bundle>
```

Dot segments in the path are rejected by the route. Prefer one independently
understandable view per `views/<slug>/`. Do not create or require a bundle
manifest — directory conventions and README embeds are the integration
surface.

`memon wiki delete` refuses a bundle holding anything besides `README.md`
unless `--force` is given; that is deliberate, so assets are never removed as
a side effect.

## The three HTML scopes

- **Inline** — raw HTML in the body (`<div>`, `<svg>`, a styled `<table>`)
  renders in place. `<script>` inside inline HTML does **not** execute; use it
  for static structure only.
- **Block** — a fenced `html embed@1` block renders its payload as an iframe.
  Block authoring is out of scope here; `SKILL.md` routes you to the skill
  that owns component blocks.
- **Page** — a bundle page may declare frontmatter
  `entry: ./views/<slug>/index.html`. That document becomes the page's primary
  body, rendered full-height, with the Markdown beneath it. An `entry` that
  does not resolve inside the bundle lints `WIKI_ENTRY_MISSING`.

Declarative content is the preferred default. Reach for page-scope HTML when
the artifact genuinely is an application, and say so in the page body.

## Author ownership

The `memon-wiki` agent always owns:

- the choice of single-file versus bundle form;
- the id, slug, kind, and every view-directory name (through the CLI);
- `README.md`, its frontmatter, narrative, citations, and embed order;
- evidence selection and the normalized data under `data/`;
- the choice to author a view directly or invoke an installed
  visualization/frontend skill;
- integration review, provenance notes, lint, and the final handoff.

Delegation never transfers those responsibilities. Do not ask an external
skill to invent evidence, rewrite page claims, choose an id, or edit the root
`README.md`.

## Delegating one view

Give a delegated skill a bounded handoff:

```yaml
page_root: docs/wiki/showcase/W0006-precond-explorer
view_slug: precond-curves
writable_directory: docs/wiki/showcase/W0006-precond-explorer/views/precond-curves
entrypoint: views/precond-curves/index.html
read_only_data:
  - data/metrics.json
task: Compare loss and throughput across the selected Variants.
runtime: Static files served from the memon wiki asset route; no dev server.
responsive: Support 390px viewport and desktop; touch and keyboard usable.
```

The delegate may write only inside its assigned `views/<slug>/`. It must not
modify root `README.md` or frontmatter, `data/`, author-owned `assets/`, a
sibling view, or anything outside the bundle. A view may contain view-local
build files, source, or vendored dependencies, provided the service-ready
static output also lives inside that same view directory.

Ask the delegate to return the static entrypoint, framework/library and
versions, the essential regeneration command, the data files consumed, and the
validation it performed. Then inspect every changed path yourself, serve the
output, add the embed, write provenance, and validate. Delegate-reported
success is not verification.

## Static runtime and relative URLs

`views/<slug>/index.html` must be ready for direct HTTP serving. A build step
may be needed to regenerate it, never to view it.

Use relative URLs for all local files, resolved from the file containing the
reference:

```js
const metrics = await fetch('../../data/metrics.json').then((response) => {
  if (!response.ok) throw new Error(`metrics: ${response.status}`)
  return response.json()
})
```

`../` segments are acceptable only when their normalized target stays inside
the same bundle. Never address arbitrary project or server files, absolute
filesystem paths, `file://`, localhost development URLs, or a
developer-specific origin.

Configure framework asset bases for relative deployment. Verify nested JS,
CSS, fonts, images, source maps if shipped, and dynamic imports through the
actual wiki asset route. Third-party HTTPS CDN assets remain allowed, but the
view must show a comprehensible loading/error or fallback state if they fail.

## Data boundary

Extract and normalize display data yourself. Prefer files under `data/` over
large literals embedded in HTML or JavaScript. Keep the source identifiers —
Experiment, Variant, run directory — in the data so a reader can trace a value
back to its Results row, and list the same identifiers in the page's
`sources`.

Treat `data/` as read-only input to a delegated skill. If a view needs a
derived field or a changed schema, the delegate proposes it and you update the
file. Never let a visualization silently redefine a fact or keep a second
canonical dataset inside its JavaScript.

Do not put credentials, tokens, private environment values, or other secrets
into JSON, CSV, HTML, CSS, JavaScript, URLs, or browser-visible metadata.

## Responsive and touch requirements

Every new or materially changed view must work from a 390 CSS-pixel-wide
viewport through a representative desktop width. Include:

```html
<meta name="viewport" content="width=device-width, initial-scale=1">
```

Required behavior:

- primary content fits the available width with no page-level horizontal
  overflow;
- charts and controls resize with their container instead of assuming a fixed
  desktop canvas;
- text stays legible and controls usable at 390 px without browser zoom;
- wide tables scroll horizontally inside a bounded region rather than widening
  the whole iframe;
- touch input is supported with adequately sized targets — prefer at least
  44 CSS pixels for primary controls where practical;
- anything shown on hover also has a tap, click, focus, or persistent path;
  hover is never the only way to read an essential value;
- visible focus and keyboard operation are retained for applicable controls;
- no essential information sits outside a fixed-height region with no internal
  way to reach it.

Test at 390 px and one desktop width such as 1280 px, exercising the real
filters, selectors, table scrolling, tooltips, and links. A screenshot alone
does not validate interaction.

## Embedding and trust

Inside a bundle `README.md`, an image-form Markdown reference to a local
`.html` file embeds it as an iframe:

```markdown
![Precond curves](./views/precond-curves/index.html)
```

A normal link to the same file remains a link:

```markdown
[Open the precond explorer](./views/precond-curves/index.html)
```

Agent-authored wiki HTML is trusted, same-origin content. The iframe is not
sandboxed and JavaScript and CDN access remain allowed; do not claim security
isolation. Enforce bundle containment, exclude credentials and secret data,
and review third-party dependencies carefully. Do not introduce a bundle
manifest or an iframe auto-height protocol — design the view to behave
responsively within the iframe viewport and scroll internally when content
legitimately exceeds it.

## Provenance and regeneration

Record enough in `README.md` for another agent to maintain each view. Use
prose or a compact table under a heading such as `## Assets`; do not create a
manifest. For each view record:

- view path and purpose;
- framework/library and important version, or `vanilla`;
- visualization/frontend skill used, or `none`;
- the data files it consumes;
- the essential regeneration/build command, or `not required`;
- material CDN dependencies and any known offline limitation;
- the Experiment, Variant, or run the data came from.

Keep commands project-relative; never record a host-specific absolute path.
When a view is updated, preserve still-valid provenance and correct stale
entries.

## Validation checklist

Before handoff:

- [ ] The bundle form is justified — the page really ships assets.
- [ ] Root frontmatter parses; `id` matches the directory prefix and `kind`
      matches the parent directory.
- [ ] `README.md` is author-written and cites its evidence in `sources`.
- [ ] Every delegated change is confined to its assigned `views/<slug>/`.
- [ ] Every embed, link, `entry`, and asset resolves inside the bundle.
- [ ] Every entry loads through the wiki asset route, not `file://`.
- [ ] Static content works without a development or application server.
- [ ] Data fetches, MIME types, dynamic imports, and CDN failure states work.
- [ ] No local URL depends on an absolute path, localhost, or one machine.
- [ ] No secret is browser-visible.
- [ ] No sandbox or auto-height claim was introduced.
- [ ] Framework, skill, data inputs, and regeneration essentials are recorded.
- [ ] The view is readable and operable at 390 px and at desktop width.
- [ ] Wide tables scroll locally; the page does not overflow.
- [ ] Touch, focus, and non-hover paths reach every essential interaction.
- [ ] `memon wiki lint <page>` reports no `error`.

## Fallback behavior

An external visualization/frontend skill is an optional implementation aid,
not a dependency. If it is unavailable, unsuitable, or fails:

1. preserve the author-owned README, data, and directory allocation;
2. try another installed skill only when it clearly fits;
3. otherwise author a smaller vanilla static HTML/CSS/JavaScript view;
4. preserve the requested evidence and essential interaction while simplifying
   decoration or advanced controls;
5. report the limitation and the attempted workaround in the handoff.

Never answer an explicit interactive request with Markdown only. If no safe
static HTML result can be produced, leave existing pages intact and give a
blocked handoff naming the missing capability and the next action.
