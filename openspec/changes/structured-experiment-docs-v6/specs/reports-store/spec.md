## MODIFIED Requirements

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
