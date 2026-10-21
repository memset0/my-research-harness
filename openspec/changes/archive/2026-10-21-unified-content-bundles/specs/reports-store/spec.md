## MODIFIED Requirements

### Requirement: Reports support legacy files and opt-in directory bundles
Reports SHALL support legacy files and folders under docs/reports/, optionally inside one category directory. Folders SHALL accept README.md frontmatter or manifest.json with type html or service, with manifest precedence. Existing files and links SHALL remain valid. New authoring SHALL favor a folder for every presentation without requiring explicit HTML permission. Assets SHALL remain contained within their bundle and preserve MIME types and binary bytes.

#### Scenario: Classified HTML report
- **WHEN** docs/reports/analysis/R0001-summary contains manifest.json and index.html
- **THEN** the Report list and detail discover it without a README adapter
- **AND** its static assets resolve within that folder

#### Scenario: Legacy report
- **WHEN** a legacy Report file or README bundle is opened
- **THEN** existing Markdown and HTML embed behavior remains available

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
An HTML Report SHALL render agent-authored static output without a build server, dependency installation or read-time generation. The entry SHALL default to index.html and be overridable by a contained relative manifest entry. Content authors SHALL choose their framework, layout, asset and data organization. Existing views/ layouts SHALL remain valid without requiring new documents to use them. Dynamic applications SHALL use the separate service manifest and forwarding contract.

#### Scenario: Arbitrary static build
- **WHEN** an agent writes index.html and relative CSS, JavaScript and JSON assets
- **THEN** memon serves the output without adding a Markdown adapter or changing its layout

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
