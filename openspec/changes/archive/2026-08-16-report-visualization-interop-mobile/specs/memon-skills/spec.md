## ADDED Requirements

### Requirement: `memon-write-report` coordinates optional external visualization skills within one view namespace

After the user explicitly requests an HTML/interactive Report,
`memon-write-report` MAY invoke a suitable visualization skill already installed
for the project. Delegation is optional and SHALL NOT install or require one
particular external skill or frontend framework. `memon-write-report` remains
the coordinator and owner of the Report ID, frontmatter, evidence claims,
`README.md` narrative/composition, and final user handoff.

Before invoking the delegate, the writer SHALL allocate one unused lowercase
kebab-case `views/<slug>/` namespace and provide the exact write path,
visualization objective, selected inputs, source-attribution requirements,
static-output/relative-URL/JSON rules, and mobile/desktop acceptance criteria.
The writer SHALL extract normalized evidence into root `data/*.json` and expose
those paths to the delegate as read-only inputs. View-local JSON MAY describe UI
configuration but SHALL NOT duplicate or redefine the normalized evidence.
The external skill SHALL write only inside that allocated namespace. It SHALL
NOT modify the Report README/frontmatter, writer-owned root `data/`, other
bundle-root files, another view, or any other project path. It SHALL return its
produced paths and validation evidence to the writer.

After delegation, `memon-write-report` SHALL verify the write scope and output,
author the README embed itself, and either accept the view or request correction.
External-skill completion alone SHALL NOT constitute Report completion.

#### Scenario: Installed visualization skill contributes one view

- **GIVEN** the user explicitly requested an interactive Report and the current
  project Agent has a suitable visualization skill installed
- **WHEN** `memon-write-report` delegates a loss-curve view
- **THEN** it assigns an unused path such as `views/loss-curves/` and supplies
  the view contract plus writer-owned root JSON as read-only evidence
- **AND** the delegate returns static output only below that path
- **AND** `memon-write-report`, not the delegate, edits README.md to embed
  `./views/loss-curves/index.html`

#### Scenario: Delegate may not manage Report identity or narrative

- **GIVEN** a visualization delegate is writing `views/latency-comparison/`
- **WHEN** it completes its work
- **THEN** it has not modified README.md, frontmatter, the Report ID/slug, or any
  sibling view
- **AND** the writer checks this boundary before accepting the output

#### Scenario: No external skill is available

- **GIVEN** the user requested an HTML Report but no suitable external
  visualization skill is installed
- **WHEN** `memon-write-report` plans the work
- **THEN** the Report may still be authored directly under the same static
  output and acceptance rules
- **AND** the absence of a delegate does not change the explicit-user-only HTML
  representation rule

### Requirement: `memon-write-report` performs final static, mobile, and desktop acceptance

Before reporting an HTML bundle complete, `memon-write-report` SHALL open each
new or changed view through the same Report asset route used by the dashboard.
It SHALL verify local fetch/import/image/font URLs and MIME types, writer-owned
root JSON data separation and read-only consumption, source attribution,
understandable loading/empty/error fallback text, and the absence of absolute
local paths or read-time server/build dependencies.

The writer SHALL test the rendered Report at exactly 390 CSS pixels wide and at
a representative desktop width of at least 1280 CSS pixels. At 390px, content
and primary controls SHALL not be page-clipped or overlap, text SHALL remain
readable, and every data dimension SHALL remain reachable through responsive
layout or intentional internal scroll/pan. At desktop width, content and
controls SHALL remain unclipped and use the available space legibly. At both
widths, the writer SHALL verify the host wrapper's Retry, Open in new tab, and
fullscreen actions are reachable.

Any unresolved failure or desktop-only limitation SHALL be reported rather than
silently accepted. These checks do not introduce a manifest or iframe
auto-height protocol.

#### Scenario: 390px acceptance catches a desktop-only view

- **GIVEN** a delegated visualization whose legend covers its controls at a
  390px viewport
- **WHEN** `memon-write-report` performs final acceptance
- **THEN** the writer does not report the Report complete
- **AND** it requests a responsive correction or reports the remaining
  limitation to the user

#### Scenario: Static portable view passes final acceptance

- **GIVEN** a view whose local assets and writer-owned root JSON resolve through
  the Report route and whose layout is usable at 390px and at least 1280px
- **WHEN** Retry, Open in new tab, fullscreen, attribution, and fallback checks
  also pass
- **THEN** `memon-write-report` may compose it into README.md and deliver the
  final Report handoff
