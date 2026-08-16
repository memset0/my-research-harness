## 1. Report-writing workflow

- [x] 1.1 Update `memon-write-report` so it may reuse a suitable visualization
  skill already installed for the project while retaining Report ID,
  frontmatter, README composition, evidence claims, and final handoff ownership.
- [x] 1.2 Add the delegated-view handoff contract: allocate one unused
  `views/<slug>/`, provide writer-owned root `data/*.json` as read-only inputs
  plus acceptance criteria, prohibit every write outside that namespace, and
  require the delegate to return produced paths and validation evidence.
- [x] 1.3 Document the framework-agnostic static-output contract, required
  `index.html`, writer-owned normalized JSON under root `data/`, relative local
  URLs such as `../../data/*.json`, optional reviewed HTTPS CDN use, and the
  absence of manifest/auto-height protocols. Permit view-local JSON only for
  presentation configuration, not normalized evidence.
- [x] 1.4 Add writer-owned final acceptance through the Report asset route at
  exactly 390px and at least 1280px, including link/MIME/fallback checks and the
  wrapper's Retry, Open in new tab, and fullscreen actions.
- [x] 1.5 Update `packages/skills/README.md` to describe optional visualization
  delegation and the ownership boundary without adding an external skill to
  memon's bundled inventory.

## 2. Responsive Report HTML host

- [x] 2.1 Extract the local `.html`/`.htm` Markdown image rendering into a
  reusable Report HTML embed wrapper while leaving normal links and images on
  their existing paths.
- [x] 2.2 Implement loading, bounded-timeout/error, and Retry states; Retry must
  create a fresh iframe load and errors must retain an Open in new tab escape
  hatch.
- [x] 2.3 Add accessible Open in new tab and Fullscreen controls, including
  graceful feedback when fullscreen is unavailable or fails while Open in new
  tab remains usable, and a supported fullscreen layout in which the iframe
  fills the available dynamic viewport.
- [x] 2.4 Replace the fixed desktop-oriented iframe minimum with bounded `svh`
  fallback plus `dvh` sizing that fits a 390px mobile viewport, without adding
  postMessage, document measurement, manifest dimensions, or auto-height.
- [x] 2.5 Preserve the unsandboxed same-origin iframe and existing report-scoped
  URL resolver/path-confinement behavior.

## 3. Compatibility and tests

- [x] 3.1 Add compatibility coverage for a nested
  `views/<slug>/index.html` fixture that fetches writer-owned root JSON through
  `../../data/*.json` plus view-local assets and verifies the existing MIME,
  traversal-rejection, and symlink-confinement behavior without changing the
  asset protocol.
- [x] 3.2 Add component tests for loading to loaded, timeout/error to Retry,
  fresh retry loads, Open in new tab, supported Fullscreen behavior, graceful
  unavailable/failed Fullscreen feedback, accessible titles, responsive
  viewport classes/styles, and the absence of a `sandbox` attribute.
- [x] 3.3 Add regression tests proving an existing root-level `chart.html`
  bundle still embeds, a normal `.html` Markdown link stays a link, and a
  standalone Markdown Report renders unchanged.
- [x] 3.4 Add a served browser fixture and verify it at 390px and at a desktop
  width of at least 1280px: no page-level clipping or overlapping controls,
  writer-owned root JSON loads, all host actions remain reachable, and
  fullscreen fills the dynamic viewport.
- [x] 3.5 Validate the updated skill frontmatter/references/line limits and
  statically verify that the delegation instructions reserve README/frontmatter
  ownership for `memon-write-report`.

## 4. Verification

- [x] 4.1 Run focused Report server, Markdown/embed component, browser, Hub
  binary-forwarding, and skill validation tests.
- [x] 4.2 Run web/skills typechecks and builds plus the production dashboard
  build; inspect served HTML/CSS and the mobile/desktop fixture per the repo UI
  verification protocol.
- [x] 4.3 Strictly validate this OpenSpec change.
