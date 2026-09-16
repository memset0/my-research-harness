## MODIFIED Requirements

### Requirement: Agent-authored HTML is a first-class body form

Free-form HTML SHALL be supported at three scopes. **Inline**: raw HTML (`<div>`, `<svg>`, inline styles, `<table>`) in the body renders in place; `<script>` inside raw HTML SHALL NOT execute. **Block**: the `embed@1` component (payload `data`, optional `height: <px|"auto">`, `title`; declared as `` ```html embed@1 `` or produced by an executable payload) SHALL render its HTML as an unsandboxed same-origin iframe built from the block content (`srcdoc`) inside the shared embed toolbar (zoom, reload, expand, mobile menu); for a bundle page the iframe document SHALL resolve relative URLs against `/api/wiki-assets/<project>/<W-id>/` so `./data/*` and `./views/*` are reachable; for a single-file page only inline and CDN resources are available. **Page**: a bundle page MAY declare frontmatter `entry: ./views/<slug>/index.html`; the dashboard SHALL then render that document as the primary body (full-height iframe through the same toolbar) with the Markdown body shown as notes beneath, and `memon wiki show` SHALL print the entry path. An `entry` that does not exist inside the bundle SHALL produce `WIKI_ENTRY_MISSING` (`error`). Multiple views remain embeddable individually via `![label](./views/<slug>/index.html)`. All HTML forms share the existing v1 trust model (trusted agent-authored, same-origin, not sandboxed, no dev server at read time). Outside the dashboard (`show`, `--format markdown`) `embed` remains a plain fenced block.

#### Scenario: Static SVG renders inline
- **GIVEN** a page body containing a hand-authored `<svg>` bar chart
- **WHEN** the page renders
- **THEN** the SVG is displayed in place without an iframe

#### Scenario: Scripted chart in an html-embed block
- **GIVEN** a bundle page containing a `` ```yaml embed@1 `` block whose function returns `{ data, height: 420 }` and has been run that loads `./data/latency.json` and draws with a CDN library
- **WHEN** the page renders
- **THEN** the block appears as a 420 px iframe with the embed toolbar and the JSON request resolves through the page's asset route

#### Scenario: HTML page entry
- **GIVEN** a `showcase` bundle with `entry: ./views/dashboard/index.html`
- **WHEN** the page opens in the dashboard
- **THEN** the view fills the reading surface with the toolbar, and the Markdown body appears beneath it

#### Scenario: Script in raw HTML is inert
- **GIVEN** `<div><script>alert(1)</script></div>` in the body
- **WHEN** the page renders
- **THEN** the div renders and the script does not execute

## REMOVED Requirements

### Requirement: Fenced blocks are the single component container
**Reason**: Replaced by `document-components` (declaration `<lang> <type>@<N> #<id>`, no info-string attributes).
**Migration**: Rewrite blocks to the new declaration; old names are no longer recognised.

### Requirement: Components are versioned by major version and every version keeps rendering
**Reason**: Replaced by `document-components` "One descriptor directory is the single source of truth"; automatic migration and `memon wiki components migrate` are dropped.
**Migration**: Outdated pinned blocks still render and are flagged `outdated`; authors rewrite them using the `memon-components` skill table.

### Requirement: Components render on every Markdown surface of the dashboard
**Reason**: Replaced by `document-components` "Components render on every Markdown surface" with document-relative resolution through the document asset route.
**Migration**: None for authors.

### Requirement: Data blocks record table data together with the script and commit that produced it
**Reason**: `memon-data` is replaced by `datatable@1`; provenance now comes from the execution cache (`component-execution`), and the `data[<n>]:<source>` staleness token is withdrawn.
**Migration**: Rewrite `memon-data@1` blocks as `datatable@1` (`columns`, `data`, `views`), moving collection scripts into `script`/`code` executable payloads.
