## MODIFIED Requirements

### Requirement: Experiment detail renders v6 and legacy sections without hiding source

The Experiment detail API SHALL expose the ordered raw README H2 occurrences, managed-document state, normalized managed-document data, shared Markdown projections, and diagnostics. The detail page SHALL render Results immediately after the Experiment header/compatibility notice, preserve source order among the remaining README sections, and render Runs as the final page card. For a valid Implementation or Investigation pointer, it SHALL render a dedicated structured component from the normalized YAML model; for a valid Results pointer, it SHALL render the Results table from the generated Results summary, or the summary's blocking error. For an unsupported or duplicate heading, it SHALL render the original body with a visible compatibility diagnostic. For a managed-pointer conflict, it SHALL render and highlight the real README body rather than substituting generated content.

An Experiment with unsupported, incomplete, or conflicting document structure SHALL remain readable. Mutating controls MAY be disabled until the bundle passes lint.

#### Scenario: Legacy content remains readable before migration
- **GIVEN** a v5 Experiment has `Method`, `Plan`, and `Caveats` but no v6 sidecars
- **WHEN** the Experiment detail page opens under the current web application
- **THEN** all three original bodies remain visible with compatibility diagnostics
- **AND** the page does not fabricate managed content

#### Scenario: Valid managed section uses normalized structured UI
- **GIVEN** an exact `## Results` pointer, a valid `experiment.json` and consistent member result files
- **WHEN** the Experiment detail page opens
- **THEN** the Results card renders an interactive table from the same generated summary used by the CLI renderer
- **AND** known Run paths link to their memon panel and available W&B page
- **AND** the literal pointer is still returned by a whole-README source read

### Requirement: Results table is controllable, bounded, and horizontally scrollable

The structured Results table SHALL show the declared columns in the active View's tree order (by default the description file's declaration order), with stable built-in Variant/Status and provenance/evidence columns around the declared columns. Every cell SHALL display at most a user-selected positive number of visual lines, defaulting to one line. Literal `<br>`, `<br/>`, `<br />`, and newline boundaries in displayed scalar text SHALL render as line breaks rather than visible markup. The table SHALL use automatic content-based column sizing inside an unbounded horizontal scroll container.

When a declared Results column has an annotation description, hovering or
keyboard-focusing its rendered table header SHALL show that Markdown in a
lightweight popup. When a rendered cell's textual value has an exact
`value_descriptions` entry, hovering or focusing that cell SHALL show the
matching Markdown. Headers and cells without descriptions SHALL retain their
existing display and interaction behavior. A header SHALL show the column's
unit when one is declared.

#### Scenario: Optional Results explanations appear in context
- **GIVEN** `params.precision` has a column description and `bf16` has a value description
- **WHEN** the user hovers the Precision header and then a `bf16` cell
- **THEN** each popup renders its corresponding Markdown
- **AND** an undescribed `fp32` cell has no annotation popup

Before the table, the page SHALL render the column visibility controls as a vertical tree, replacing the former horizontal strip of column checkboxes: the three partition nodes (`params`, `metrics`, `env`), one node per group (path prefix) and one leaf per declared or undeclared column, top to bottom in tree order, with collapsible tree nodes. Checking or clearing a node SHALL apply to every descendant; a node whose descendants are partly checked SHALL render as indeterminate. The checked state SHALL be stored on the node that was changed and inherited by its descendants, so a column that appears later follows the state of its group; without a saved choice, the description file's default visibility applies and the `env` partition is hidden. Each leaf SHALL show the number of distinct non-empty values present for that column, and hovering or focusing its value-domain affordance SHALL show those values one per list row.

Columns whose path is a metric SHALL be visually distinguishable from parameters through a restrained pale-blue treatment in the column controls, table header, and table body. Metric controls SHALL NOT display a redundant `Metric` badge and SHALL NOT open a value-domain preview on hover or focus; their distinct-value count MAY remain visible. Parameter and environment columns SHALL retain the default treatment and value-domain preview. Project-level starred-column highlighting SHALL take visual precedence when a metric column is also starred.

An exact HTTP(S) scalar URL whose hostname is `wandb.ai` or a subdomain of `wandb.ai` SHALL render as an external link with primary-color emphasis, underline styling, and a chart/line-plot leading icon. Its visible label SHALL be the decoded final non-empty URL path segment, falling back to the hostname when no segment exists, while its full original URL remains the link target and appears in a hover/focus tooltip. The compact link SHALL constrain its visible width and truncate unusually long final IDs. Non-W&B URLs SHALL retain the ordinary scalar-text rendering in this change, and hosts that merely contain `wandb.ai` without being that domain or a subdomain SHALL NOT receive the specialization.

#### Scenario: Dense Results stay scannable
- **GIVEN** a Results summary with many columns, long strings, and multi-line values
- **WHEN** the user opens the Experiment page without saved preferences
- **THEN** every cell is bounded to one visual line
- **AND** the table can scroll horizontally without clipping columns
- **AND** line-break markup is rendered as actual line breaks

#### Scenario: User checks a whole group
- **GIVEN** a group `params.optim` with columns `lr` and `batch_size`, both unchecked
- **WHEN** the user checks the `params.optim` node
- **THEN** both columns appear in the table
- **WHEN** the user then clears `batch_size`
- **THEN** the `params.optim` node renders as indeterminate and only `lr` stays visible

#### Scenario: User filters columns and inspects their domains
- **GIVEN** a declared parameter column has three distinct non-empty values across Variants
- **WHEN** the user views the column controls
- **THEN** that column's leaf shows a distinct-value count of three
- **AND** its value-domain preview lists the three values on separate rows
- **AND** clearing its checkbox removes the column from the table without modifying any source file

#### Scenario: Metric columns are recognizable at a glance
- **GIVEN** Results declares one parameter path and one metric path
- **WHEN** the column controls and table render
- **THEN** the metric control, header, and body cells share a pale-blue accent while the parameter column keeps the default treatment
- **AND** the metric control contains no `Metric` badge and hovering it does not reveal values
- **AND** hovering the parameter control still reveals its value-domain preview

#### Scenario: W&B URL cells stay compact and identifiable
- **GIVEN** a Results string value `https://wandb.ai/acme/project/runs/a1b2c3d4`
- **WHEN** the table renders that cell
- **THEN** it shows a chart icon and underlined `a1b2c3d4` link instead of the complete URL
- **AND** activating the link opens the complete URL
- **AND** hovering or focusing the link reveals the complete URL

### Requirement: Direct YAML edits refresh without corrupting README locks

The Web runtime SHALL observe each managed YAML sidecar, `experiment.json`, the Experiment bundle directory and README.md, and SHALL observe member Runs' `result.csv` files through the Results summary's input validation. An edit of a managed source or a member result file SHALL refresh the affected projection (regenerating the Results summary when its inputs changed) without a restart and SHALL emit the normal Experiment change signal. The aggregate bundle mtime MAY advance for list activity, but every README mutation SHALL use README.md's own mtime as its optimistic lock.

#### Scenario: Agent edits only results.yaml
- **GIVEN** an Experiment page is backed by a valid v9 bundle
- **WHEN** an Agent edits only a leftover `results.yaml`
- **THEN** the Results table does not change and lint reports `LEGACY_RESULTS_YAML`

#### Scenario: Agent edits only the description file
- **GIVEN** an Experiment page is backed by a valid cached bundle
- **WHEN** an Agent directly updates only `experiment.json`
- **THEN** the runtime refreshes the Results table without requiring a restart or README edit
- **AND** a later status/archive mutation using `readmeMtime` is not rejected because the description file is newer

#### Scenario: A Run's result file changes
- **WHEN** a script rewrites a member Run's `result.csv` while the Experiment page is open
- **THEN** the Results table shows the new value after the member window or an explicit refresh

### Requirement: Results ordering is directly draggable and preference-backed

Column ordering SHALL be performed by dragging nodes vertically in the column tree: every node SHALL be draggable within its parent — a column among the columns and subgroups of its group, a group among its sibling groups and columns, a partition among the partitions. Dragging a rendered table header MAY be offered as a secondary entry that obeys the same rules; it is not required. Dragging a group SHALL move all of its columns and subgroups as one block. A column or group SHALL NOT be dropped outside its parent group, because groups come from result paths; such a drop SHALL be refused without changing the order. Displayed unpinned columns of one group SHALL always be contiguous in the table. Every accepted drop SHALL update one shared tree order, and both the tree and the table SHALL immediately reflect it. Hidden columns SHALL keep their position in the order and reappear there when shown again.

Pinning SHALL apply to single columns only, never to a group or partition node. A pinned column SHALL leave its group's block and appear in the single pinned zone on the left, after the Variant name column, which is always pinned first; its header SHALL show a breadcrumb of its group labels joined by `›` (for example `Optimizer › LR`) so the context stays visible; unpinning SHALL return it to its previous position inside its group. Group contiguity SHALL constrain only the unpinned zone. The column tree SHALL mark pinned columns with a pin indicator and SHALL list them in a pinned section at its top, where vertical dragging sets their order in the pinned zone.

Whenever pinned columns use sticky positioning, every pinned header and body cell SHALL render an opaque background so horizontally scrolled content cannot show through. Metric columns SHALL use an opaque pale-blue surface and starred columns SHALL use an opaque amber surface with starred emphasis taking precedence. When the pinned-width fallback disables sticky positioning, the normal non-sticky accent treatment MAY remain translucent.

The tree order and the checked state SHALL be stored in the active Results View and SHALL use the existing View synchronization. They SHALL NOT modify `experiment.json`. Without a saved choice, the description file's declaration order and default visibility SHALL apply. Restoring a partial or stale order SHALL discard unknown or duplicate IDs and SHALL append each newly available column at the end of its own group.

Saved row-filter badges SHALL be draggable into a persistent display and evaluation order. Their visible priority SHALL match their array order. Because filters retain AND composition, reordering the same filter set MAY change short-circuit evaluation order but SHALL NOT change which rows satisfy that set.

Saved default-sort badges SHALL be draggable into a persistent priority order. The leftmost badge SHALL remain the primary comparator, subsequent badges SHALL break ties from left to right, and Variant ID SHALL remain the final tie-breaker. A successful drag SHALL clear any temporary header sort and immediately recompute row order.

#### Scenario: Checkbox drag and header drag share column order
- **GIVEN** a group with columns A, B and C
- **WHEN** the user drags the C leaf above A in the vertical column tree
- **THEN** both the tree and the table render C, A, B
- **WHEN** header dragging is offered and the user drags header B before C
- **THEN** both surfaces render B, C, A
- **AND** refreshing restores that order and the existing checked states

#### Scenario: Partial saved order accepts a new document column
- **GIVEN** a View that saves column B before A in group `metrics.eval`
- **WHEN** the current `experiment.json` also declares column C in that group
- **THEN** B and A retain their relative order and C appears inside the `metrics.eval` block
- **AND** no stale or duplicate saved ID produces a duplicate tree node or table column

#### Scenario: A group moves as one block
- **GIVEN** sibling groups `params.optim` (lr, batch_size) and `params.model` (depth) in that order
- **WHEN** the user drags the `params.model` node before `params.optim`
- **THEN** the table shows depth, lr, batch_size, with lr and batch_size still adjacent

#### Scenario: A column cannot leave its group
- **WHEN** the user drags the `lr` leaf of `params.optim` onto a position inside `params.model`
- **THEN** the drop is refused and the order is unchanged

#### Scenario: Pinning one column of a group
- **GIVEN** a group `params.optim` labelled "Optimizer" with columns LR and Batch size
- **WHEN** the user pins LR
- **THEN** LR appears in the pinned zone after the Variant name column with the header breadcrumb `Optimizer › LR`, Batch size stays in the unpinned zone, and the tree shows LR with a pin indicator in its pinned section
- **WHEN** the user unpins LR
- **THEN** LR returns before Batch size inside the `params.optim` block

#### Scenario: Sticky metric pins do not reveal scrolling content
- **GIVEN** a metric column is pinned and the combined pin width permits sticky positioning
- **WHEN** unpinned columns scroll behind that metric header and its body cells
- **THEN** the pinned metric surfaces use an opaque pale-blue background
- **AND** no text or color from the scrolling columns is visible through them
- **WHEN** the same pinned metric column is starred
- **THEN** its pinned surfaces use an opaque amber background instead

#### Scenario: Dragged filter order persists
- **GIVEN** two saved AND row filters displayed as priorities one and two
- **WHEN** the user drags the second filter before the first
- **THEN** their displayed and stored priority order is reversed
- **AND** refresh restores that order without changing the AND composition

#### Scenario: Dragged default sort changes the result
- **GIVEN** default sort A then B produces one row order
- **WHEN** the user drags B before A
- **THEN** B becomes priority one and A priority two
- **AND** the table immediately renders the row order produced by B then A
- **AND** refresh restores both the priority and resulting row order

### Requirement: Results can refresh independently with visible snapshot age

Every Results card SHALL expose a Refresh action. Activating it SHALL obtain the current Results summary through an authenticated, read-only Results snapshot endpoint (which re-takes every input fingerprint for that request) and SHALL replace only the Results content rendered inside that card. The action SHALL NOT reload or refetch the complete Experiment page, remount unrelated document sections or Run panels, or reset Results table visibility, ordering, filters, pinning, sorting, stars, temporary controls, or other client preferences.

The Results card SHALL show `Last updated` using the newest server-observed modification time among the summary's inputs and `Stale for` using elapsed time since that same time. The stale duration SHALL advance while the page remains open. A successful manual Refresh SHALL update both displays only from the time returned by the backend: reading unchanged inputs SHALL NOT reset Stale for, while reading changed inputs SHALL recompute it. The initial Experiment detail response SHALL provide that time so rendering status does not require an immediate duplicate Results request. When the detail defers a summary too large to embed (`summaryDeferred`), the card SHALL show a loading state and obtain the summary from the Results snapshot endpoint once on first render and again when the detail reports a newer input time; the rest of the page SHALL render without waiting for it.

While refresh is pending, the action SHALL be disabled and visibly indicate progress. A successful response SHALL atomically replace the Results content and time. A response reporting `RESULT_SCHEMA_MISMATCH` or `RESULT_DUPLICATE_ROW` SHALL replace the table with the blocking error state. An invalid or missing description file, authorization failure, network failure, or other non-success response SHALL retain the complete last good Results content and its time, clear the pending state, and show a local understandable error with Refresh still available for retry. The refresh path SHALL NOT modify any source file, and the stale-status timer SHALL NOT trigger any automatic backend request.

#### Scenario: Results refresh without disturbing the page
- **GIVEN** an open Experiment page with a valid Results table, expanded Run panel, and configured table preferences
- **AND** a member Run's `result.csv` changes on disk
- **WHEN** the user activates the Results Refresh action
- **THEN** only the Results table receives the regenerated summary
- **AND** the expanded Run panel, other document sections, and all Results preferences remain unchanged
- **AND** Last updated and Stale for are both derived from the new input time

#### Scenario: Refreshing unchanged Results does not reset staleness
- **GIVEN** displayed Results whose newest input was modified one hour ago
- **AND** no input changed
- **WHEN** the user activates Refresh
- **THEN** Last updated remains the same
- **AND** Stale for remains approximately one hour rather than restarting near zero

#### Scenario: Refresh retains the last good snapshot on invalid YAML
- **GIVEN** the open page displays a valid Results table
- **AND** the current `experiment.json`, which replaces `results.yaml`, becomes invalid
- **WHEN** the user activates Refresh
- **THEN** the endpoint returns `INVALID_RESULTS` without writing any file
- **AND** the Results card continues to display the previous table and time with a local error, and Refresh stays available for retry

#### Scenario: A schema mismatch replaces the table
- **GIVEN** the open page displays a valid Results table
- **AND** a member `result.csv` now records another `experiment_schema_version`
- **WHEN** the user activates Refresh
- **THEN** the card shows the `RESULT_SCHEMA_MISMATCH` error state with the offending file and the upgrade command and no Variant row

#### Scenario: Initial status does not duplicate the Results request
- **GIVEN** the Experiment detail response contains a valid Results summary
- **WHEN** the Results card first renders
- **THEN** it displays the input modification time and its current age from that response
- **AND** it does not call the dedicated Results snapshot endpoint until the user activates Refresh

#### Scenario: A deferred summary loads from the Results endpoint
- **GIVEN** the Experiment detail response defers the Results summary for size
- **WHEN** the Experiment page renders
- **THEN** the other sections render from the detail and the Results card shows a loading state
- **AND** the card requests the Results snapshot endpoint once and renders the table from its answer

### Requirement: Experiment Results Views are centrally shared

The Results table SHALL present named Views bound to the current Experiment. Selecting a View SHALL apply its complete persistent filters, checked-column visibility, column order, maximum line count, default sort chain, pinning, row overrides, SOTA modes, and decimal formatting. Owners SHALL be able to create, duplicate, rename, edit, reset, and delete Views; exact-scope share viewers SHALL be able to list, select, and inspect the same Views without modifying any View. Each Results column header SHALL cycle through the configured default sort, temporary ascending order, temporary descending order, and back to the configured default. Header-created sorting SHALL remain only in mounted client state and SHALL NOT survive refresh. Right-clicking a table header SHALL open a context menu that can hide, pin, unpin, or star/unstar that column; a hidden column remains recoverable from the column tree. Pinned columns SHALL appear in the single left pinned zone after the always-first Variant name column and before unpinned columns, in the order of the column tree's pinned section (initially the order in which the user pinned them) rather than declaration order. A stored View that pins columns on the right SHALL render them at the end of the left pinned zone. A column name MAY also be starred from the controls; starred names SHALL persist at Project scope and highlight every column with the exact same display name across that Project's Experiments.

Durable View definitions SHALL be stored in the central `memon-ui-preferences.sqlite3` View collection without a username dimension. Browser storage SHALL provide immediate owner rendering, ordered asynchronous synchronization, retryable dirty state, and local active selection, but a clean browser copy SHALL not create a user-specific fork. The server response SHALL distinguish an empty View collection from a present View whose definition contains no filters. When the server collection is empty and an owner browser has legacy state, that state SHALL remain active and be migrated as a View. UI state and browser storage SHALL update without waiting for the server write. Project-wide starred column labels SHALL remain outside the Experiment View definition.

The Results controls SHALL expose the persistent default sort as an ordered list of editable badges. Each badge SHALL select one unique column and ascending or descending direction; badges SHALL be compared from left to right and SHALL support changing priority. Natural Variant-ID ascending order SHALL be the deterministic final tie-breaker and the entire default when no badges exist. A temporary header sort SHALL become the primary comparator while active, with the default chain continuing to break ties. Clicking the Variant header SHALL support the same temporary ascending and descending cycle as every other column.

The Results controls SHALL allow one or more row filters over any displayed or hidden column using equals, does-not-equal, greater-than, or less-than comparisons. Multiple filters SHALL combine with AND. Every saved filter SHALL render as a compact badge that opens an editor for its column, operator, and value when clicked; a trailing add-filter badge SHALL open the same editor for a new condition. A per-Variant override SHALL be able to use automatic filtering, force-show, or force-hide, with the override taking precedence over ordinary filters. Override actions SHALL be available from a rendered row's context menu; no permanent Auto/Show/Hide control SHALL consume space in the first visible cell, and no dedicated top-level row selector SHALL render. Empty scalar values and empty evidence arrays SHALL be addressable by an equals-empty filter. Array-valued Runs and Attempts SHALL match equals/greater/less when any member matches and shall match does-not-equal only when no member equals the target.

Rows and columns SHALL each provide an independent temporary show-all toggle. Temporary show-all SHALL bypass the saved filters or hidden-column set without deleting or changing them, SHALL expose the complete row or column set, and SHALL not be stored in browser persistence. Resuming filters, selecting another View, or refreshing the page SHALL restore the selected View's saved setup.

When the combined rendered width of visible pinned columns is less than the horizontal viewport, pinned columns SHALL remain sticky at the left while the unpinned columns scroll. Sticky offsets SHALL account for every preceding pinned column so pinned columns do not overlap. When the combined pinned width is greater than or equal to the viewport width, sticky positioning SHALL be disabled for all pinned columns; the table SHALL scroll as one surface while retaining the pinned-then-unpinned grouping and user-selected pin order.

#### Scenario: Refresh restores table preferences

- **GIVEN** a user hides a column, configures a multi-column default sort, sets cells to three lines, and adds row filters and overrides in one View
- **WHEN** the page is refreshed in the same browser
- **THEN** the same active View, visibility, default-sort chain, three-line limit, row filters, and row overrides are restored

#### Scenario: SQLite absence differs from an explicitly empty filter set

- **GIVEN** browser storage contains legacy row filters for the current Experiment
- **WHEN** the authenticated owner's SQLite View collection is empty
- **THEN** the browser filters remain active and are migrated into a View
- **BUT WHEN** SQLite has a View whose saved filter list is empty
- **THEN** that explicit empty list remains authoritative for that View

#### Scenario: Guests stay browser-only

- **GIVEN** an anonymous session reaches a Results surface without authenticated View access
- **WHEN** the table initializes
- **THEN** no central View collection is returned or mutated

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
- **THEN** the context menu offers to hide, pin (or unpin), and star or unstar the column
- **AND** hiding it updates the active View's persisted checkbox state

#### Scenario: Pinned columns remain visible without overlap

- **GIVEN** multiple pinned Results columns whose combined width is smaller than the table viewport
- **WHEN** the user scrolls the table horizontally
- **THEN** every pinned column remains fixed at the left after the Variant name column
- **AND** pinned columns use their persisted user-selected order and non-overlapping offsets

#### Scenario: Oversized pin groups degrade to ordered scrolling

- **GIVEN** visible pinned columns whose combined width is greater than or equal to the table viewport
- **WHEN** the table lays out or its viewport is resized
- **THEN** no Results column uses sticky positioning
- **AND** pinned columns remain first in their user-selected order while the whole table scrolls

#### Scenario: Star follows a column name across Experiments

- **GIVEN** two Experiments in one Project both declare a column labeled `Final loss`
- **WHEN** the user stars `Final loss` in the first Experiment and opens the second
- **THEN** the `Final loss` header and cells are highlighted in the second Experiment
- **AND** the star is not copied into either Experiment View definition

#### Scenario: Checkbox and filter combination belongs to the active View

- **GIVEN** an owner selected View `Latency review`
- **WHEN** the owner hides two columns and adds a latency filter
- **THEN** the table updates immediately
- **AND** the complete `Latency review` definition is persisted for that Experiment
- **AND** selecting another View applies that View's independent definition

#### Scenario: Share viewer sees the same Views read-only

- **GIVEN** an exact-scope share viewer opens an Experiment
- **WHEN** the Results table loads
- **THEN** the viewer sees and may select every centrally stored View for that Experiment
- **AND** cannot change checkboxes, filters, formatting, names, or View lifecycle

## ADDED Requirements

### Requirement: Stats cells render by display selection and rank by a statistic

A `stats` column SHALL always occupy exactly one table column; the table SHALL NOT offer expanding it into one column per statistic. Its display SHALL be switched only through a dropdown in its header, offering the single statistics the column carries (for example `mean` or the outer `p99` of the inner `max`) and the templates `mean±std`, `mean±sem`, `mean (min–max)`, `mean [ci95]`, `p50 (p25–p75)` and `p50/p99` whose statistics the column carries; the choice SHALL be stored in the active View, and without one the column's default display applies — `mean ± std (n)` for a cell aggregated across several Runs. A cell SHALL render using the column's unit and decimal formatting; a statistic the cell lacks SHALL render as an empty value. Hovering or focusing a stats cell SHALL list every statistic it carries, its dimensions and, for a cell aggregated across Runs, the number of contributing Runs. Sorting, greater/less filters and SOTA SHALL compare the selected sort statistic of a stats column (by default the statistic its display selects, else `mean`), and SOTA SHALL use the column's declared direction. Frozen historical cells, mixed cells, cells not aggregated and cells whose actual value differs from the Variant's planned value SHALL each carry a visible marker, and the tooltip of a differing cell SHALL show the planned value. The header dropdown SHALL offer only statistics of the fixed vocabulary that the column carries and templates built from them.

#### Scenario: Mean plus or minus standard deviation
- **GIVEN** a stats column displayed as `mean±std` and a cell with `mean` 0.312 and `std` 0.021 at three decimals
- **WHEN** the table renders
- **THEN** the cell reads `0.312 ± 0.021` and its tooltip lists both statistics

#### Scenario: Seeds aggregate by default
- **GIVEN** a numeric metric aggregated over three evidence Runs with mean 11 and std 1 and no View selection
- **WHEN** the table renders
- **THEN** the cell reads `11 ± 1 (3)`

#### Scenario: Switching the display keeps one column
- **GIVEN** a stats column showing `mean ± std`
- **WHEN** the user selects `p50/p99` in its header dropdown
- **THEN** the same single column now shows each cell's `p50` and `p99`, no additional column appears, and the selection is saved in the active View

#### Scenario: SOTA by lower-is-better p99
- **GIVEN** a latency column with direction `lower` whose View sorts by the outer `p99` of the inner `max`
- **WHEN** SOTA highlighting is enabled
- **THEN** the Variant with the smallest such value is highlighted as best

### Requirement: Results show a blocking error for inconsistent inputs

When an Experiment's Results summary fails with `RESULT_SCHEMA_MISMATCH` or `RESULT_DUPLICATE_ROW` — and, when no good Results content is displayed yet, with `INVALID_RESULTS` — the Results card SHALL render an error state instead of the table: the error code, every offending file as a project-relative path with its recorded version or duplicate lines (or the description file diagnostics), and for a schema mismatch the exact upgrade command with a copy action. It SHALL NOT render any Variant row, cell or partial table for that Experiment. The rest of the Experiment page and every other Experiment SHALL render normally. The error SHALL refresh like the table, so it disappears once the inputs are consistent.

#### Scenario: Schema mismatch error card
- **GIVEN** an Experiment whose description file records version 2 and one member result file records version 1
- **WHEN** the Experiment page opens
- **THEN** the Results card shows `RESULT_SCHEMA_MISMATCH`, that file with version 1 and the command `memon experiment schema upgrade <experiment-id> --to 2`
- **AND** no Variant row is rendered

### Requirement: Results headers stack two levels and groups collapse

The Results table header SHALL stack at most two rows: the first row SHALL show, for each run of adjacent unpinned columns, the label of their group directly below the partition, spanning those columns; the second row SHALL show the column label, prefixed by the labels of any deeper groups joined with `›` (for example `adam › beta1` under `Optimizer`). A group SHALL be collapsible from its header: a collapsed group SHALL render as one narrow placeholder column showing the group label and the number of its visible columns, and expanding it SHALL restore them in order. Collapsing SHALL be independent of hiding: hidden columns stay hidden inside an expanded group, a collapsed group whose columns are all hidden SHALL NOT render, and the collapsed state SHALL be stored in the active View. Undeclared columns SHALL render like declared ones, labelled by their last path segment.

#### Scenario: Deep group merged into the column name
- **GIVEN** columns `params.optim.adam.beta1` and `params.optim.lr` with `params.optim` labelled "Optimizer"
- **WHEN** the table renders
- **THEN** the first header row shows "Optimizer" spanning both columns and the second row shows `adam › beta1` and `lr`

#### Scenario: Collapse and hide coexist
- **GIVEN** group `metrics.eval` with three columns of which one is hidden
- **WHEN** the user collapses the group and expands it again
- **THEN** the collapsed placeholder reports two visible columns and the expanded group shows the same two columns with the hidden one still hidden

### Requirement: Run panels show the Run's result file

An expanded Run panel on the Experiment page SHALL show the Run's `result.csv`, when the Run has one, as a read-only collapsible tree built from the rows the Run detail response carries: the partitions in `params`, `metrics`, `env` order (any other top-level group after them), one node per group (path prefix), and one leaf per path showing its scalar value or one row per statistic in vocabulary order. The section SHALL show the recorded `experiment_schema_version`, the number of rows (marked when truncated) and the file's parse diagnostics. A Run without a result file SHALL show no result section, and the tree SHALL NOT offer editing.

#### Scenario: Grouped result rows
- **GIVEN** a Run whose `result.csv` records `env.CUDA`, `metrics.eval.clip` `std` and `mean`, `metrics.notes` and `params.optim.lr` in that order
- **WHEN** the user expands that Run on the Experiment page
- **THEN** the panel lists Parameters, Metrics and Environment in that order, `clip` under `eval` with `mean` before `std`
- **AND** folding Metrics hides its rows while Parameters stays visible
