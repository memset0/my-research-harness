## MODIFIED Requirements

### Requirement: Results table is controllable, bounded, and horizontally scrollable

The structured Results table SHALL preserve `results.yaml` column order for unpinned columns, with stable built-in Variant/Status and provenance/evidence columns around the declared columns. Every cell SHALL display at most a user-selected positive number of visual lines, defaulting to one line. Literal `<br>`, `<br/>`, `<br />`, and newline boundaries in displayed scalar text SHALL render as line breaks rather than visible markup. The table SHALL use automatic content-based column sizing inside an unbounded horizontal scroll container.

Before the table, the page SHALL render one checkbox control per available column in the original YAML/built-in order, independent of pinning. Each control SHALL show the number of distinct non-empty values present for that column. Hovering or focusing the value-domain affordance SHALL show those values one per list row.

Columns declared with `group: metric` SHALL be visually distinguishable from parameters through a restrained pale-blue treatment in the column controls, table header, and table body. Metric controls SHALL NOT display a redundant `Metric` badge and SHALL NOT open a value-domain preview on hover or focus; their distinct-value count MAY remain visible. Parameter columns SHALL retain the default treatment and value-domain preview. Project-level starred-column highlighting SHALL take visual precedence when a metric column is also starred.

An exact HTTP(S) scalar URL whose hostname is `wandb.ai` or a subdomain of `wandb.ai` SHALL render as an external link with primary-color emphasis, underline styling, and a chart/line-plot leading icon. Its visible label SHALL be the decoded final non-empty URL path segment, falling back to the hostname when no segment exists, while its full original URL remains the link target and appears in a hover/focus tooltip. The compact link SHALL constrain its visible width and truncate unusually long final IDs. Non-W&B URLs SHALL retain the ordinary scalar-text rendering in this change, and hosts that merely contain `wandb.ai` without being that domain or a subdomain SHALL NOT receive the specialization.

#### Scenario: Dense Results stay scannable
- **GIVEN** a Results document with many columns, long strings, and multi-line values
- **WHEN** the user opens the Experiment page without saved preferences
- **THEN** every cell is bounded to one visual line
- **AND** the table can scroll horizontally without clipping columns
- **AND** line-break markup is rendered as actual line breaks

#### Scenario: User filters columns and inspects their domains
- **GIVEN** a declared Results column has three distinct non-empty values across Variants
- **WHEN** the user views the column controls
- **THEN** that column's control shows a distinct-value count of three
- **AND** its value-domain preview lists the three values on separate rows
- **AND** clearing its checkbox removes the column from the table without modifying YAML

#### Scenario: Metric columns are recognizable at a glance
- **GIVEN** Results declares one `group: parameter` column and one `group: metric` column
- **WHEN** the column controls and table render
- **THEN** the metric control, header, and body cells share a pale-blue accent while the parameter column keeps the default treatment
- **AND** the metric control contains no `Metric` badge and hovering it does not reveal values
- **AND** hovering the parameter control still reveals its value-domain preview

#### Scenario: W&B URL cells stay compact and identifiable
- **GIVEN** a Results scalar value `https://wandb.ai/acme/project/runs/a1b2c3d4`
- **WHEN** the table renders that cell
- **THEN** it shows a chart icon and underlined `a1b2c3d4` link instead of the complete URL
- **AND** activating the link opens the complete URL
- **AND** hovering or focusing the link reveals the complete URL
