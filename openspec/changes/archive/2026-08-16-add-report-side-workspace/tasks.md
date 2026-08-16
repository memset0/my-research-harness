## 1. URL and Artifact Resolution

- [x] 1.1 Add pure helpers for parsing, updating, and removing `report` / `reportSurface` URL state while preserving applicable pathname, query, and hash state.
- [x] 1.2 Add unit tests for valid, malformed, missing, preserved-query, canonical-full-Report, and history-restorable Report URL cases.
- [x] 1.3 Add a pure current-project artifact inventory and Markdown href resolver covering canonical web routes plus relative/absolute legacy, standalone, and bundle document paths.
- [x] 1.4 Add resolver tests for the real E0017/R0003/R0005/R0007 path shapes, encoding, fragments, ambiguity, cross-project paths, external URLs, and unresolved files.
- [x] 1.5 Add and test the six-cell source-surface/target-kind navigation destination builder.

## 2. Shared Workspace Layout

- [x] 2.1 Refactor the root terminal surface provider into a single terminal-or-Report surface coordinator without changing the existing terminal hook contract.
- [x] 2.2 Add a workspace split outlet below the project AppBar and manage header so headers and the project sidebar remain outside the split.
- [x] 2.3 Generalize split/drawer resize labels, width clamping, and CSS offset variables for the shared right-side slot and fixed project footer.
- [x] 2.4 Add layout/provider tests proving AppBar/header placement, preserved left React subtree, mutual exclusion, mobile drawer fallback, and terminal drawer/split/popup regression behavior.

## 3. Report Drawer and Split Surface

- [x] 3.1 Extract reusable read-only Report document rendering from `InboxShell` without changing full-page Report editing or bundle rendering.
- [x] 3.2 Implement Report drawer/split loading, missing, error, close, move-surface, and canonical-full-page controls driven by URL state.
- [x] 3.3 Implement the side Report identity Popover with current selection, loading/empty states, bounded scrolling, keyboard dismissal, and right-only switching.
- [x] 3.4 Add component/browser tests for Report open, switch, close, refresh restoration, query preservation, drawer/split movement, mobile fallback, and terminal replacement.

## 4. Intelligent Markdown Artifact Links

- [x] 4.1 Add source-document and source-surface context for Experiment, full-page Report, and side Report Markdown renderers.
- [x] 4.2 Add a remark transform that links only uniquely resolvable bare `Rxxxx` / `Exxxx` identifiers and skips links, code, raw HTML, math, unresolved IDs, and identifier substrings.
- [x] 4.3 Enhance explicit Markdown anchors so resolvable artifact document hrefs use contextual destinations before Report resource rewriting while GitHub previews and ordinary links retain their behavior.
- [x] 4.4 Decorate only the literal uppercase-letter-plus-four-digits label substring with bold `text-primary`, leaving punctuation, title, slug, and other label text unaccented.
- [x] 4.5 Add renderer tests for bare IDs, full Experiment IDs, explicit relative/absolute links, E0017 sample links, bundle resources, styling boundaries, exclusions, ambiguity, and GitHub/ordinary-link regression behavior.
- [x] 4.6 Add navigation tests for Experiment→Experiment/Report, full Report→Experiment/Report, and side Report→Experiment/Report, including retaining or replacing the correct side.

## 5. Verification and Delivery

- [x] 5.1 Run focused component/browser suites plus terminal provider, Report bundle, Markdown, and layout regressions; fix all failures.
- [x] 5.2 Run web type checking and the production build.
- [x] 5.3 Validate the OpenSpec change strictly and mark completed tasks accurately.
- [x] 5.4 Deploy the verified build on port 3737 and confirm the authenticated service responds.

## 6. Stable Split Interaction Follow-up

- [x] 6.1 Track split-divider pointer movement and release across the window, enlarge its practical hit target, and preserve keyboard resizing.
- [x] 6.2 Use soft internal links for artifact route changes and History-only replacement when only Report query state changes on the same left pathname.
- [x] 6.3 Add regressions for dragging outside the divider and for opening/switching Reports without remounting or reloading the left Experiment.
- [x] 6.4 Re-run focused tests, type checking, production build, strict OpenSpec validation, and redeploy port 3737.

## 7. Report HTML Zoom Follow-up

- [x] 7.1 Add a Report-scoped shared iframe zoom state with a 100% default, 10% controls, accessible percentage output, and bounded range.
- [x] 7.2 Scale iframe content without changing the Report layout, load/error handling, fullscreen, or external-open behavior.
- [x] 7.3 Add tests for default scale, ten-percent stepping, bounds, and shared multi-iframe zoom.
- [x] 7.4 Keep the iframe toolbar compact on mobile instead of forcing tall action and zoom buttons.

## 8. Report Table of Contents Follow-up

- [x] 8.1 Generate a Report-only TOC from level-two through level-six Markdown headings and place it before the body title.
- [x] 8.2 Assign stable, Report-prefixed, Unicode-safe, duplicate-aware anchors to the TOC targets.
- [x] 8.3 Apply the shared TOC to both full-page and side-pane Reports without changing Digest rendering.
- [x] 8.4 Add renderer and Report integration regressions, run type checking and production build, strictly validate OpenSpec, and redeploy port 3737.
