## MODIFIED Requirements

### Requirement: Experiment Results Views are centrally shared

The Results table SHALL present named Views bound to the current Experiment. Selecting a View SHALL apply its complete persistent filters, checked-column visibility, column order, maximum line count, default sort chain, pinning, row overrides, SOTA modes, and decimal formatting. Owners SHALL be able to create, duplicate, rename, edit, reset, and delete Views; exact-scope share viewers SHALL be able to list, select, and inspect the same Views without modifying any View. Each Results column header SHALL cycle through the configured default sort, temporary ascending order, temporary descending order, and back to the configured default. Header-created sorting SHALL remain only in mounted client state and SHALL NOT survive refresh. Right-clicking a table header SHALL open a context menu that can hide, pin left, pin right, unpin, or star/unstar that column; a hidden column remains recoverable from the checkbox controls above the table. Pinned-left columns SHALL appear before unpinned columns and pinned-right columns SHALL appear after them, with each pinned group using the order in which the user pinned or moved columns rather than YAML order. A column name MAY also be starred from the controls; starred names SHALL persist at Project scope and highlight every column with the exact same display name across that Project's Experiments.

Durable View definitions SHALL be stored in the central `memon-ui-preferences.sqlite3` View collection without a username dimension. Browser storage SHALL provide immediate owner rendering, ordered asynchronous synchronization, retryable dirty state, and local active selection, but a clean browser copy SHALL not create a user-specific fork. The server response SHALL distinguish an empty View collection from a present View whose definition contains no filters. When the server collection is empty and an owner browser has legacy state, that state SHALL remain active and be migrated as a View. UI state and browser storage SHALL update without waiting for the server write. Project-wide starred column labels SHALL remain outside the Experiment View definition.

The Results controls SHALL expose the persistent default sort as an ordered list of editable badges. Each badge SHALL select one unique column and ascending or descending direction; badges SHALL be compared from left to right and SHALL support changing priority. Natural Variant-ID ascending order SHALL be the deterministic final tie-breaker and the entire default when no badges exist. A temporary header sort SHALL become the primary comparator while active, with the default chain continuing to break ties. Clicking the Variant header SHALL support the same temporary ascending and descending cycle as every other column.

The Results controls SHALL allow one or more row filters over any displayed or hidden column using equals, does-not-equal, greater-than, or less-than comparisons. Multiple filters SHALL combine with AND. Every saved filter SHALL render as a compact badge that opens an editor for its column, operator, and value when clicked; a trailing add-filter badge SHALL open the same editor for a new condition. A per-Variant override SHALL be able to use automatic filtering, force-show, or force-hide, with the override taking precedence over ordinary filters. Override actions SHALL be available from a rendered row's context menu; no permanent Auto/Show/Hide control SHALL consume space in the first visible cell, and no dedicated top-level row selector SHALL render. Empty scalar values and empty evidence arrays SHALL be addressable by an equals-empty filter. Array-valued Runs and Attempts SHALL match equals/greater/less when any member matches and shall match does-not-equal only when no member equals the target.

Rows and columns SHALL each provide an independent temporary show-all toggle. Temporary show-all SHALL bypass the saved filters or hidden-column set without deleting or changing them, SHALL expose the complete row or column set, and SHALL not be stored in browser persistence. Resuming filters, selecting another View, or refreshing the page SHALL restore the selected View's saved setup.

When the combined rendered width of visible pinned columns is less than the horizontal viewport, pinned columns SHALL remain sticky at their respective side while the unpinned middle columns scroll. Sticky offsets SHALL account for every preceding pinned column on that side so pinned columns do not overlap. When the combined pinned width is greater than or equal to the viewport width, sticky positioning SHALL be disabled for all pinned columns; the table SHALL scroll as one surface while retaining the pinned-left, unpinned, pinned-right grouping and user-selected pin order.

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
- **THEN** the context menu offers to hide, pin left, pin right, and star or unstar the column
- **AND** hiding it updates the active View's persisted checkbox state

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

## RENAMED Requirements

- FROM: `### Requirement: Results view preferences persist locally and for the logged-in owner`
- TO: `### Requirement: Experiment Results Views are centrally shared`
