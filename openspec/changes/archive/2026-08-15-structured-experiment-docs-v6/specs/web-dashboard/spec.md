## ADDED Requirements

### Requirement: Experiment detail renders v6 and legacy sections without hiding source

The Experiment detail API SHALL expose the ordered raw README H2 occurrences, managed-document state, normalized managed-document data, shared Markdown projections, and diagnostics. The detail page SHALL render Results immediately after the Experiment header/compatibility notice, preserve source order among the remaining README sections, and render Runs as the final page card. For a valid Implementation, Investigation, or Results pointer, it SHALL render a dedicated structured component from the normalized YAML model. For an unsupported or duplicate heading, it SHALL render the original body with a visible compatibility diagnostic. For a managed-pointer conflict, it SHALL render and highlight the real README body rather than substituting YAML.

An Experiment with unsupported, incomplete, or conflicting document structure SHALL remain readable. Mutating controls MAY be disabled until the bundle passes v6 lint.

#### Scenario: Legacy content remains readable before migration
- **GIVEN** a v5 Experiment has `Method`, `Plan`, and `Caveats` but no v6 sidecars
- **WHEN** the Experiment detail page opens under the v6 web application
- **THEN** all three original bodies remain visible with compatibility diagnostics
- **AND** the page does not fabricate managed YAML content

#### Scenario: Valid managed section uses normalized structured UI
- **GIVEN** an exact `## Results` pointer and valid `results.yaml`
- **WHEN** the Experiment detail page opens
- **THEN** the Results card renders an interactive table from the same normalized document used by the CLI renderer
- **AND** known Run IDs link to their memon panel and available W&B page
- **AND** the literal pointer is still returned by a whole-README source read

### Requirement: Results table is controllable, bounded, and horizontally scrollable

The structured Results table SHALL preserve `results.yaml` column order for unpinned columns, with stable built-in Variant/Status and provenance/evidence columns around the declared columns. Every cell SHALL display at most a user-selected positive number of visual lines, defaulting to one line. Literal `<br>`, `<br/>`, `<br />`, and newline boundaries in displayed scalar text SHALL render as line breaks rather than visible markup. The table SHALL use automatic content-based column sizing inside an unbounded horizontal scroll container.

Before the table, the page SHALL render one checkbox control per available column in the original YAML/built-in order, independent of pinning. Each control SHALL show the number of distinct non-empty values present for that column. Hovering or focusing the value-domain affordance SHALL show those values one per list row.

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

#### Scenario: W&B URL cells stay compact and identifiable
- **GIVEN** a Results scalar value `https://wandb.ai/acme/project/runs/a1b2c3d4`
- **WHEN** the table renders that cell
- **THEN** it shows a chart icon and underlined `a1b2c3d4` link instead of the complete URL
- **AND** activating the link opens the complete URL
- **AND** hovering or focusing the link reveals the complete URL

### Requirement: Results view preferences persist locally and for the logged-in owner

Each Results column header SHALL cycle through the configured default sort, temporary ascending order, temporary descending order, and back to the configured default. Header-created sorting SHALL remain only in mounted client state and SHALL NOT survive refresh. Right-clicking a table header SHALL open a context menu that can hide, pin left, pin right, unpin, or star/unstar that column; a hidden column remains recoverable from the checkbox controls above the table. Per-Experiment column visibility, ordered default-sort rules, maximum cell-line count, pin side, user-selected pin order, row filters, and row overrides SHALL persist in browser local storage and restore after refresh. Pinned-left columns SHALL appear before unpinned columns and pinned-right columns SHALL appear after them, with each pinned group using the order in which the user pinned or moved columns rather than YAML order. A column name MAY also be starred from the controls; starred names SHALL persist at Project scope and highlight every column with the exact same display name across that Project's Experiments.

For an authenticated owner, the same JSON preferences SHALL also be stored under that configured username in `memon-ui-preferences.sqlite3` beside the active `config.yml`. The server response SHALL distinguish a missing row from a present row whose value contains no filters. A present server row SHALL override conflicting browser state, including an explicitly saved empty filter set. When the server row is missing and browser state exists, the browser state SHALL remain active and be migrated to SQLite. UI state and browser storage SHALL update without waiting for the server write. Viewer and anonymous sessions SHALL neither read nor write this database and SHALL remain browser-only.

The Results controls SHALL expose the persistent default sort as an ordered list of editable badges. Each badge SHALL select one unique column and ascending or descending direction; badges SHALL be compared from left to right and SHALL support changing priority. Natural Variant-ID ascending order SHALL be the deterministic final tie-breaker and the entire default when no badges exist. A temporary header sort SHALL become the primary comparator while active, with the default chain continuing to break ties. Clicking the Variant header SHALL support the same temporary ascending and descending cycle as every other column.

The Results controls SHALL allow one or more row filters over any displayed or hidden column using equals, does-not-equal, greater-than, or less-than comparisons. Multiple filters SHALL combine with AND. Every saved filter SHALL render as a compact badge that opens an editor for its column, operator, and value when clicked; a trailing add-filter badge SHALL open the same editor for a new condition. A per-Variant override SHALL be able to use automatic filtering, force-show, or force-hide, with the override taking precedence over ordinary filters. Override actions SHALL be available from a rendered row's context menu; no permanent Auto/Show/Hide control SHALL consume space in the first visible cell, and no dedicated top-level row selector SHALL render. Empty scalar values and empty evidence arrays SHALL be addressable by an equals-empty filter. Array-valued Runs and Attempts SHALL match equals/greater/less when any member matches and shall match does-not-equal only when no member equals the target.

Rows and columns SHALL each provide an independent temporary show-all toggle. Temporary show-all SHALL bypass the saved filters or hidden-column set without deleting or changing them, SHALL expose the complete row or column set, and SHALL not be stored in browser persistence. Resuming filters or refreshing the page SHALL restore the saved setup.

When the combined rendered width of visible pinned columns is less than the horizontal viewport, pinned columns SHALL remain sticky at their respective side while the unpinned middle columns scroll. Sticky offsets SHALL account for every preceding pinned column on that side so pinned columns do not overlap. When the combined pinned width is greater than or equal to the viewport width, sticky positioning SHALL be disabled for all pinned columns; the table SHALL scroll as one surface while retaining the pinned-left, unpinned, pinned-right grouping and user-selected pin order.

#### Scenario: Refresh restores table preferences
- **GIVEN** a user hides a column, configures a multi-column default sort, sets cells to three lines, and adds row filters and overrides
- **WHEN** the page is refreshed in the same browser
- **THEN** the same visibility, default-sort chain, three-line limit, row filters, and row overrides are restored

#### Scenario: SQLite absence differs from an explicitly empty filter set
- **GIVEN** browser storage contains row filters for the current Experiment
- **WHEN** the authenticated owner's SQLite key has no row
- **THEN** the browser filters remain active and are migrated to SQLite
- **BUT WHEN** SQLite has a row whose saved filter list is empty
- **THEN** that explicit empty list overrides the browser filters

#### Scenario: Guests stay browser-only
- **GIVEN** a viewer-share or anonymous session changes Results preferences
- **WHEN** the UI updates and the page is refreshed
- **THEN** the preferences use browser storage only
- **AND** no SQLite preference row is read or written for that session

#### Scenario: Default sort chains multiple columns
- **GIVEN** default-sort badges `Cube size T ascending` followed by `Cube size H descending`
- **WHEN** multiple Variants have equal `Cube size T`
- **THEN** `Cube size H` determines their relative order
- **AND** equal rows fall back to Variant ID ascending

#### Scenario: Header sorting is temporary
- **GIVEN** a persisted multi-column default sort
- **WHEN** the user clicks one column header once
- **THEN** that column temporarily sorts ascending as the primary comparator
- **AND** a second click uses temporary descending order
- **AND** a third click or a refresh returns to the persisted default chain

#### Scenario: Row predicates and overrides compose predictably
- **GIVEN** filters `loss > 0.15`, `loss < 0.25`, and `status = COMPLETED`
- **WHEN** a non-matching Variant is force-shown and a matching Variant is force-hidden
- **THEN** ordinary rows must satisfy every predicate
- **AND** the force-shown Variant remains visible while the force-hidden Variant is absent

#### Scenario: Filter badges support direct editing
- **GIVEN** a saved badge `loss > 0.15`
- **WHEN** the user clicks that badge, changes its value, and saves
- **THEN** the existing condition is updated in place without creating a duplicate
- **AND** the trailing add-filter badge remains available for another condition

#### Scenario: Row override is edited from the context menu
- **GIVEN** a currently rendered Variant row
- **WHEN** the user opens its context menu
- **THEN** force-show, force-hide, and clear-override choices are available as applicable
- **AND** no row-override control is rendered in a table cell or above the table

#### Scenario: Temporary show-all preserves saved configuration
- **GIVEN** saved hidden columns, row filters, and row overrides
- **WHEN** the user temporarily shows all columns or all rows
- **THEN** the complete corresponding set is visible without modifying those saved conditions
- **AND** resuming or refreshing reapplies the saved conditions

#### Scenario: Header context menu manages one column
- **GIVEN** a visible Results column header
- **WHEN** the user right-clicks it
- **THEN** the context menu offers to hide, pin left, pin right, and star or unstar the column
- **AND** hiding it updates the persisted checkbox state

#### Scenario: Pinned columns remain visible without overlap
- **GIVEN** multiple Results columns pinned on the left and right whose combined width is smaller than the table viewport
- **WHEN** the user scrolls the table horizontally
- **THEN** every pinned column remains fixed at its selected side
- **AND** pinned columns on the same side use their persisted user-selected order and non-overlapping offsets

#### Scenario: Oversized pin groups degrade to ordered scrolling
- **GIVEN** visible pinned columns whose combined width is greater than or equal to the table viewport
- **WHEN** the table lays out or its viewport is resized
- **THEN** no Results column uses sticky positioning
- **AND** pinned-left columns remain first and pinned-right columns remain last in their user-selected order while the whole table scrolls

#### Scenario: Star follows a column name across Experiments
- **GIVEN** two Experiments in one Project both declare a column labeled `Final loss`
- **WHEN** the user stars `Final loss` in the first Experiment and opens the second
- **THEN** the `Final loss` header and cells are highlighted in the second Experiment

### Requirement: Direct YAML edits refresh without corrupting README locks

The Web runtime SHALL poll each managed YAML sidecar and the Experiment bundle directory in addition to README.md. A sidecar edit SHALL reload the complete bundle and emit the normal Experiment change signal. The aggregate bundle mtime MAY advance for list activity, but every README mutation SHALL use README.md's own mtime as its optimistic lock.

#### Scenario: Agent edits only results.yaml
- **GIVEN** an Experiment page is backed by a valid cached v6 bundle
- **WHEN** an Agent directly updates only `results.yaml`
- **THEN** the runtime reloads the Results projection without requiring a restart or README edit
- **AND** a later status/archive mutation using `readmeMtime` is not rejected because the YAML is newer
