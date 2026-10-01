# reports-store Specification

## Purpose
Defines project Reports under `docs/reports/`, both legacy single-file reports and opt-in directory bundles (including framework-agnostic static HTML visualization bundles), and the list, read and optimistic-locked write APIs that serve them from a polling-backed cache. It serves the dashboard's Reports pages and agents writing reports with the `memon-write-report` skill. The files are the source of truth; long-lived knowledge can move into the Wiki through `memon wiki migrate-report`, and the reading UI is specified by `report-workspace`.

## Requirements
### Requirement: GET /api/reports?project=NAME lists all reports

`GET /api/reports?project=<name>` SHALL return `{ reports: ReportSummary[] }` sorted by `id` descending. `ReportSummary` SHALL include `id`, `slug`, `path` (absolute), `mtime`, and `title` (the first H1 heading of the file body, or null if absent). The response SHALL NOT include the file content (use `GET /api/reports/<id>` for that). The response SHALL be served from the runtime cache populated at warmup; no `fs.readFile` per request on the hot path.

#### Scenario: Empty directory
- **WHEN** the project has `docs/reports/` empty or missing
- **THEN** the API returns `{ reports: [] }` with HTTP 200

#### Scenario: Sort by id desc
- **GIVEN** reports `R0001-a`, `R0003-c`, `R0002-b`
- **WHEN** the API returns the list
- **THEN** order is `R0003-c, R0002-b, R0001-a`

#### Scenario: Title extracted from first H1
- **GIVEN** `R0001-attn.md` whose body starts with `# Attention overlap analysis`
- **WHEN** the API returns the list
- **THEN** the entry's `title` is `"Attention overlap analysis"`

#### Scenario: Missing H1 yields null title
- **GIVEN** `R0007-quick.md` whose body has no top-level H1
- **WHEN** the API returns the list
- **THEN** the entry's `title` is `null`

### Requirement: GET /api/reports/[id]?project=NAME returns one report

`GET /api/reports/<id>?project=<name>` SHALL return `{ id, slug, path, mtime, hash, content }` for the report whose canonical id matches. `hash` SHALL be the sha1 hex digest of the UTF-8 content. The id SHALL match the canonical regex `^R\d{4}$`; non-matching ids return 400 BAD_REQUEST. A report id whose file does not exist returns 404 NOT_FOUND.

#### Scenario: Read existing report
- **WHEN** the user requests `/api/reports/R0001?project=p`
- **THEN** the response includes the file's mtime, sha1 hash, and full markdown content

#### Scenario: Bad id format
- **WHEN** the user requests `/api/reports/foo?project=p`
- **THEN** the response is 400 BAD_REQUEST with `error.code: "BAD_REQUEST"`

#### Scenario: Missing report
- **WHEN** the user requests `/api/reports/R9999?project=p` and no such file exists
- **THEN** the response is 404 NOT_FOUND

### Requirement: PUT /api/reports/[id]?project=NAME writes with mtime+hash optimistic lock

`PUT /api/reports/<id>?project=<name>` body `{ content, expectedMtime, expectedHash }` SHALL atomically replace the file's content via a `.tmp.<random>` sibling + rename. On success, return `{ ok: true, mtime, hash }` reflecting the post-write state. The server SHALL refuse the write and return 409 CONFLICT with `{ error: { code: "CONFLICT" }, currentMtime, currentHash, currentContent }` when on-disk mtime !== expectedMtime OR on-disk hash !== expectedHash. The path used for the write SHALL be validated by `assertWithinProjectRoots()`; out-of-root attempts return 403 FORBIDDEN.

#### Scenario: Successful write
- **GIVEN** the client read mtime/hash, then the user types and clicks Save
- **WHEN** PUT carries the matching expectedMtime+expectedHash
- **THEN** the file is rewritten and the response carries the new mtime+hash

#### Scenario: Stale mtime → 409 CONFLICT
- **GIVEN** an external write happened between client read and client save
- **WHEN** PUT arrives with the now-stale expectedMtime
- **THEN** the response is 409 with the current on-disk mtime, hash, and content

#### Scenario: Path traversal attempt blocked
- **WHEN** a request resolves to a path outside any configured project root
- **THEN** the response is 403 FORBIDDEN

### Requirement: Live cache backed by Poller

The runtime SHALL maintain an in-memory cache of all reports for every configured project. The cache SHALL be warmed at server start. The shared `Poller` SHALL watch `<projectRoot>/docs/reports/` (the directory itself, for additions/deletions) and every individual file matching the regex (for content changes). On `mtime` advance, the cache SHALL refresh the affected entry; on directory change the cache SHALL re-scan and update the list.

#### Scenario: New file appears
- **WHEN** a skill writes `R0042-new.md` to the watched directory
- **THEN** within the configured polling window, the cache reflects the new entry and an SSE invalidation event with kind `reports` fires
- **AND** subsequent `GET /api/reports?project=...` returns it

#### Scenario: External edit reflected
- **WHEN** an external process edits an existing report's content
- **THEN** the cache's content for that entry refreshes within the polling window and an SSE invalidation fires

### Requirement: Reports support legacy files and opt-in directory bundles

Reports SHALL be discovered in either legacy file form `docs/reports/R<NNNN>-<slug>.md` or directory form `docs/reports/R<NNNN>-<slug>/README.md`. Existing files remain valid and SHALL NOT be migrated. The report-writing skill SHALL select directory form only when the user explicitly requests HTML.

Directory report assets SHALL be served only from within that report directory with correct MIME types. A Markdown image whose relative target ends in `.html` SHALL render as an unsandboxed same-origin iframe. A normal Markdown link to the same target SHALL remain a link. Local and CDN JavaScript/CSS are allowed by the v1 trust model.

#### Scenario: HTML image embeds and HTML link does not
- **GIVEN** a directory Report README containing `![Chart](./chart.html)` and `[Open chart](./chart.html)`
- **WHEN** the report renders
- **THEN** the image form becomes an iframe
- **AND** the link form remains a clickable link

#### Scenario: Asset traversal is rejected
- **WHEN** a report asset request attempts to resolve `../` outside the report directory
- **THEN** the server rejects it without reading the escaped path

#### Scenario: Hub preserves binary report assets
- **GIVEN** a Report image, font, PDF, or WASM asset is served by a cluster node through the Hub
- **WHEN** the Hub forwards the node response to the browser
- **THEN** the response bytes are identical to the source asset
- **AND** HTML, CSS, JavaScript, JSON, and YAML remain UTF-8 text responses

### Requirement: HTML Report bundles are framework-agnostic static visualization containers

An opt-in directory Report SHALL be usable as a static visualization container
independent of the technology used to author it. A view MAY be plain
HTML/CSS/JavaScript or checked-in compiled output from any frontend framework,
but opening the Report through memon's existing Report asset route SHALL NOT
require a package install, framework development server, Python/Node backend, or
build step at read time.

For a newly delegated visualization, the canonical write namespace SHALL be
`views/<slug>/`, where `<slug>` is lowercase kebab-case. The namespace SHALL
contain a stable `index.html` entry and every static file produced by that
delegate. Substantial normalized evidence SHALL be stored separately in
writer-owned root `data/*.json` rather than embedded as a large literal in HTML
or JavaScript. A delegated view SHALL treat root `data/` as read-only and load
it through a relative URL such as `../../data/metrics.json`. View-local JSON MAY
hold presentation configuration, but SHALL NOT duplicate or redefine the
normalized evidence source.

Every Report-owned URL used by the view SHALL be relative to the view or Report
bundle and resolve within the Report directory. Carefully reviewed third-party
HTTPS CDN JavaScript/CSS remains allowed under the existing v1 trust model. An
absolute filesystem path, hard-coded memon origin, or dependency on a runtime
build server SHALL NOT be required to render the view.

This contract SHALL NOT require or consult a Report manifest, framework
metadata, declared iframe dimensions, or automatic-height metadata. Existing
directory Reports with HTML/assets outside `views/` and existing standalone
Markdown Reports remain valid without migration.

#### Scenario: Framework build output is served as ordinary static assets

- **GIVEN** a delegated view at `views/loss-curves/index.html` with compiled
  JavaScript/CSS and writer-owned root `data/metrics.json`
- **WHEN** the view is opened through the Report asset route
- **THEN** the HTML, compiled assets, and JSON are served with their correct MIME
  types and the view renders without a framework server or build command

#### Scenario: View data remains separate and portable

- **GIVEN** `views/loss-curves/index.html` loads
  `../../data/metrics.json` and `./assets/view.js`
- **WHEN** the Report directory is moved with its contents intact to another
  configured project root
- **THEN** both relative URLs continue to resolve through that Report's asset
  route
- **AND** the primary metrics are inspectable in JSON rather than only inside a
  generated HTML/JavaScript literal

#### Scenario: No manifest is needed

- **GIVEN** a valid directory Report containing README.md and a local HTML entry
  but no manifest or declared dimensions
- **WHEN** the dashboard discovers and renders the Report
- **THEN** discovery and rendering succeed exactly as for other directory
  Reports

#### Scenario: Existing root-level HTML remains compatible

- **GIVEN** an existing bundle whose README embeds `![Chart](./chart.html)` and
  whose HTML is not under `views/`
- **WHEN** the upgraded dashboard opens the Report
- **THEN** `chart.html` is still served and embedded
- **AND** no file is moved, rewritten, or reported invalid solely because it
  predates the delegated-view namespace

