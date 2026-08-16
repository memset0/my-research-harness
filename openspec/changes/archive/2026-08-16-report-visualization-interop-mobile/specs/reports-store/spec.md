## ADDED Requirements

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
