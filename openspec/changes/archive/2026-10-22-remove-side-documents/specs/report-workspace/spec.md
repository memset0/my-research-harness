## REMOVED Requirements

### Requirement: Artifact links follow paired-workspace navigation rules
**Reason**: Superseded by full-page navigation for every surface.
**Migration**: Links that opened a document beside the current page now open its full page.

### Requirement: Reports open in a drawer or right split
**Reason**: The side workspace is retired; every Report has its own full page.
**Migration**: Open the Report's full page (`/h/<host>/p/<project>/reports/<R-id>`).

### Requirement: Report workspace state is encoded in the URL
**Reason**: No side Report exists to encode.
**Migration**: Page URLs carrying `report` or `reportSurface` redirect to the same URL without them (see "Legacy side-document parameters redirect away").

### Requirement: Side Report exposes an accessible quick switcher
**Reason**: Removed with the side Report surface.
**Migration**: Switch Reports from the Reports page list.

## MODIFIED Requirements

### Requirement: Existing Markdown file links are resolved to artifacts

When an existing Markdown link targets a current-project Experiment, Report, or wiki document, the renderer SHALL recognize it as an artifact link even when its label does not contain an artifact ID. Resolution SHALL support relative paths resolved from the source Markdown file, absolute filesystem paths equal to a discovered artifact source, canonical project web routes, standalone Report files, Report bundle `README.md` files, single-file wiki pages at `docs/wiki/<kind>/<slug>.md`, wiki bundle `README.md` files at `docs/wiki/<kind>/<slug>/README.md`, and Experiment bundle `README.md` files. Query strings and fragments SHALL not prevent target recognition.

Resolved artifact links SHALL use the same navigation as generated bare-identifier links. When the visible Markdown link label contains the resolved `Rxxxx`, `Wxxxx`, or `Exxxx` token, only that identifier substring SHALL receive the bold theme-primary treatment; the rest of the link label SHALL retain its ordinary link typography. A label without an identifier remains fully clickable but gains no invented or whole-label emphasis. External URLs, non-Markdown files, paths outside the current project, and unresolved or ambiguous document paths SHALL retain their original link target and ordinary link behavior. Existing GitHub permalink previews SHALL remain unaffected.

#### Scenario: Relative Report link is recognized from an Experiment
- **GIVEN** Experiment `E0017` contains `[R0007: learning guide](../../reports/R0007-inference-kernel-learning-guide/README.md)`
- **WHEN** the link renders and is activated
- **THEN** the `R0007` part of its visible label is bold and theme-primary while the remaining label text is not
- **AND** the browser navigates to the full page of Report `R0007`

#### Scenario: Relative Experiment link is recognized from a Report
- **GIVEN** a Report contains `[E0017 current experiment](../experiments/E0017-inference-kernels/README.md)`
- **WHEN** the link renders and is activated
- **THEN** only an `E0017` token present in its visible label receives the bold theme-primary treatment
- **AND** the browser navigates to canonical Experiment `E0017-inference-kernels`

#### Scenario: Ordinary Markdown link remains ordinary
- **GIVEN** a Markdown link points to a source-code README, an external site, or an unresolved local file
- **WHEN** the Markdown renders
- **THEN** its href and ordinary link behavior remain unchanged

#### Scenario: Single-file wiki target is recognized
- **GIVEN** a project document links to `../wiki/finding/common-path-debt.md`
- **WHEN** the link renders and is activated
- **THEN** it is recognized as the wiki page owning that slug
- **AND** the browser navigates to that page's full page

#### Scenario: Wiki bundle README target is recognized
- **GIVEN** Experiment `E0017` contains `[W0004: kernel map](../../wiki/showcase/kernel-map/README.md)`
- **WHEN** the link renders
- **THEN** it resolves to the wiki page owning the `kernel-map` slug
- **AND** only a `W0004` token present in the label receives the bold theme-primary treatment

#### Scenario: Report path stays a Report link while the Report exists
- **GIVEN** a wiki page links to `../../reports/R0007-inference-kernel-learning-guide/README.md`
- **WHEN** the link renders while that Report still exists
- **THEN** it resolves to Report `R0007` rather than to any wiki page carrying `legacy_id: R0007`

## ADDED Requirements

### Requirement: Legacy side-document parameters redirect away

A page request (GET or HEAD, outside `/api/`) whose URL carries any of the retired query parameters `report`, `reportSurface`, `wiki` or `wikiSurface` SHALL be redirected to the same path with those four parameters removed and every other parameter kept, before page rendering. The redirect SHALL apply before authentication so a bookmarked or shared old link reaches the normal page and login flow.

#### Scenario: Bookmarked paired view
- **WHEN** a browser opens `/h/host-a/p/project-a/e/E0017-inference-kernels?run=sample&report=R0007&reportSurface=split`
- **THEN** it is redirected to `/h/host-a/p/project-a/e/E0017-inference-kernels?run=sample`
- **AND** the Experiment page renders without any side Report

### Requirement: Artifact links open the target's full page

Artifact-link activation SHALL navigate to the target's canonical full page on every surface: an Experiment target to its canonical Experiment route with the full Experiment ID, a Report target to its full Report route, and a wiki target to its full wiki route using the canonical `W<NNNN>` id even when the author wrote a legacy `R<NNNN>` token that resolved through `legacy_id`. Destinations SHALL NOT carry the source page's query or fragment. Activation SHALL use normal internal-link semantics so keyboard activation, modifier-click to a new tab and browser fallback remain available.

#### Scenario: Experiment links to a Report
- **GIVEN** Experiment `E0017` is open
- **WHEN** a Report link to `R0007` in its README is activated
- **THEN** the browser navigates to the full page of Report `R0007`

#### Scenario: Report links to an Experiment
- **GIVEN** the full page of Report `R0003` is open
- **WHEN** its content activates a link to `E0017`
- **THEN** the browser navigates to canonical Experiment `E0017-inference-kernels` and no Report stays open beside it

#### Scenario: Legacy token resolves to the canonical wiki page
- **GIVEN** a document contains `R0007`, Report `R0007` no longer exists, and page `W0021` carries `legacy_id: R0007`
- **WHEN** the link is activated
- **THEN** the browser navigates to the full page of `W0021`
- **AND** the visible label still reads `R0007`
