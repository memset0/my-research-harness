## Context

The structured-documents v6 change added opt-in directory Reports at
`docs/reports/R<NNNN>-<slug>/README.md`. A local `.html` image reference in the
README becomes an unsandboxed, same-origin iframe; sibling files are served from
a path-confined Report asset route with correct MIME types. Existing Markdown
Reports remain canonical and are not migrated.

That format is intentionally permissive, but it does not yet say how
`memon-write-report` can reuse a visualization specialist without surrendering
ownership of the Report. It also leaves the iframe as a raw rendering detail:
the current fixed minimum height is awkward on a 390px-wide phone and the user
gets no explicit load state, retry path, separate-tab view, or fullscreen view.

## Goals / Non-Goals

**Goals:**

- Let `memon-write-report` optionally delegate one visualization to a suitable
  project-installed skill through a narrow, auditable write boundary.
- Keep Report output portable and viewable as static files through memon's
  existing asset route, independent of the authoring framework.
- Separate structured display data from presentation code and keep all local
  references portable and relative.
- Make HTML embeds usable and recoverable at exactly 390 CSS pixels wide and at
  a representative desktop width.
- Preserve explicit-user-only HTML creation, bundle path confinement, and the
  accepted unsandboxed same-origin trust model.
- Preserve all existing Markdown Reports and directory bundles byte-for-byte.

**Non-Goals:**

- Selecting, installing, or standardizing one visualization skill or frontend
  framework.
- Adding a Report manifest, view registry, framework metadata, build recipe, or
  schema-version field.
- Running a framework dev server, Python service, Node service, or build step
  when a reader opens a Report.
- Inferring iframe height from its document, adding a postMessage resize
  protocol, or reading declared dimensions from metadata.
- Sandboxing or cross-origin-isolating Agent-authored HTML in this version.
- Moving old root-level HTML/assets into `views/` or converting standalone
  Markdown Reports.

## Decisions

### D1. The Report bundle is the deployment boundary; `views/<slug>/` is the delegation boundary

`README.md` remains the canonical narrative and composition document. A new
visualization delegated to an external skill receives one lowercase kebab-case
namespace chosen by the writer:

```text
docs/reports/R0042-training-analysis/
├── README.md                         # owned by memon-write-report
├── data/                             # normalized evidence owned by the writer
│   └── metrics.json
└── views/
    └── loss-curves/                  # delegated write boundary
        ├── index.html                # stable entry point
        └── assets/
            ├── view.js
            └── view.css
```

The delegate may create any static files below its assigned directory, including
compiled framework output, but may not write another view, the bundle root,
`README.md`, frontmatter, or root `data/`. The writer prepares normalized
evidence under root `data/` and supplies it to the delegate as read-only input.
The stable README embed is authored later by the writer, for example:

```markdown
![Training loss comparison](./views/loss-curves/index.html)
```

The namespace rule applies to newly delegated work. An existing bundle such as
`R0002-rich/chart.html` remains valid and is neither linted as legacy nor moved.

### D2. `memon-write-report` owns allocation, handoff, composition, and acceptance

When an HTML/interactive Report was explicitly requested and a suitable
visualization skill is already available to the project Agent,
`memon-write-report` may delegate a view. Delegation is optional; absence or
failure of an external skill does not redefine the Report format and the writer
may author the view itself.

Before delegation, the writer allocates an unused `views/<slug>/` path and gives
the delegate:

- the absolute Report root and exact relative write namespace;
- the visualization question, writer-owned root JSON inputs, and required
  attribution;
- the required `index.html` entry point and the read-only `data/*.json`
  boundary;
- the local-relative URL, static-output, mobile, desktop, and trust constraints;
- an explicit prohibition on editing `README.md`, its frontmatter, or any path
  outside the namespace.

The delegate returns the paths it produced and any validation evidence. The
writer verifies that all writes are in scope, reviews the result, adds the
README narrative/embed itself, and remains responsible for the final user
handoff. Delegation therefore cannot silently change Report identity, title,
selector, evidence claims, or composition.

### D3. Authoring technology is free; reading requires only static HTTP assets

A view may be plain HTML/CSS/JavaScript or prebuilt output from React, Vue,
Svelte, Vega, Observable, or another tool. The committed output must load from
the existing Report asset route without a package install, dev server, backend,
or build-at-read-time step.

Report-owned HTML, JSON, JavaScript, CSS, images, fonts, and other assets use
relative URLs and remain inside the bundle. Existing support for carefully
reviewed third-party HTTPS CDN scripts/styles remains available; it is not a
substitute for absolute local filesystem paths or hard-coded memon hostnames.

The writer extracts and owns substantial normalized evidence in root
`data/*.json` rather than placing a large literal in HTML or JavaScript. A view
below `views/<slug>/` reads it through a relative URL such as
`../../data/metrics.json` and treats it as immutable. View-local JSON is allowed
only for presentation configuration or generated UI state that does not become
a second source of evidence. HTML/JavaScript provides understandable loading,
empty, and error text. This keeps facts inspectable and lets presentation code
be replaced independently.

### D4. Final acceptance covers both the static view and its host at mobile and desktop widths

Before accepting a delegated view, `memon-write-report` opens it through the
same `/api/report-assets/...` route used by the dashboard and checks:

1. `index.html` and every local fetch/import/image/font resolve with the intended
   MIME type; no local URL relies on an absolute filesystem path, hard-coded
   origin, or runtime build server.
2. Structured display data is in JSON separate from the presentation layer and
   source attribution/fallback text remains understandable.
3. At exactly 390 CSS pixels wide, content is not clipped by the page, primary
   controls do not overlap, text remains readable, and every data dimension is
   reachable. A chart/table may use an intentional internal scroll or pan when
   its semantics cannot be collapsed.
4. At a representative desktop width of at least 1280 CSS pixels, the view uses
   the available space without clipped controls or unreadably stretched text.
5. The README embed loads in the dashboard wrapper, and Retry, Open in new tab,
   and fullscreen remain reachable at both widths.

Acceptance is behavioral rather than framework-specific. The writer reports any
remaining limitation instead of accepting a desktop-only visualization.

### D5. A host-owned iframe wrapper provides state and controls

The Markdown image convention still selects an iframe, but the renderer places
it inside a reusable Report HTML embed wrapper. The wrapper owns:

- a visible loading state until the iframe fires `load`;
- a visible error state when loading errors or exceeds a bounded timeout;
- Retry, which starts a fresh load rather than leaving a dead iframe in place;
- Open in new tab, using the same Report asset URL with `noopener` semantics;
- fullscreen using the browser Fullscreen API, with graceful inline feedback
  when unavailable and Escape/browser-native exit behavior when supported;
- a title derived from the Markdown image alt/title text.

Open in new tab remains available when fullscreen is unavailable or fails.
Normal height uses a small-viewport-unit fallback and a dynamic-viewport-unit
override (for example `svh` followed by `dvh`) with sensible bounds. It must not
impose a desktop minimum taller than the usable mobile viewport. In fullscreen,
the wrapper and iframe fill the available dynamic viewport.

The height remains host-controlled. Loading state changes and fullscreen do not
create an iframe-content auto-height protocol.

### D6. Trust and compatibility do not change

The iframe remains same-origin and carries no `sandbox` attribute. Its HTML may
run JavaScript and use the existing local/CDN behavior, so the writer continues
to create HTML only after an explicit user request, excludes secrets, and
reviews third-party dependencies. Server-side lexical and realpath confinement
remain mandatory.

The wrapper is triggered by the existing local `.html`/`.htm` image syntax, so
old root-level entries gain the new host controls without a format rewrite.
Normal Markdown links remain links, normal images remain images, and standalone
Markdown Reports render exactly as before. No manifest is required or consulted.

## Risks / Trade-offs

- Unsandboxed same-origin HTML can access memon browser state and APIs. This is
  an explicit retained trust decision, mitigated only by explicit HTML requests,
  path confinement, dependency review, and secret exclusion.
- A fixed host-controlled responsive height can leave internal scrolling in
  some views. That is preferred to a new cross-document sizing protocol and is
  recoverable through fullscreen/open-new-tab actions.
- External skills have heterogeneous quality. The narrow write namespace and
  writer-owned acceptance prevent that variability from silently rewriting the
  Report contract.
- CDN-based views can fail offline. Static local output is preferred for
  durability, while the existing HTTPS CDN allowance remains for cases where
  its trade-off is accepted and reviewed.

## Migration Plan

- No data migration and no FS convention bump.
- Existing `.md` Reports and bundle directories remain untouched.
- New delegated views adopt `views/<slug>/`; old HTML locations continue to be
  discovered and served.
- Rollback removes the new writer guidance and iframe wrapper while leaving all
  Report files readable through the pre-existing asset route.
