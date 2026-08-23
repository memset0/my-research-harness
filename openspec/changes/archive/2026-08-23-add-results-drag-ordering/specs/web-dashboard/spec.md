## ADDED Requirements

### Requirement: Results ordering is directly draggable and preference-backed

Every Results column control and rendered table header SHALL be draggable against other columns. Dropping a column from either surface SHALL update one shared ordered list of stable column IDs, and both the checkbox controls and table SHALL immediately reflect the same saved order. Pinned-left, unpinned, and pinned-right placement SHALL remain in force, with the shared order applied within each group. Hidden columns SHALL remain in the ordered list and retain their position when shown again.

Whenever pinned columns use sticky positioning, every pinned header and body cell SHALL render an opaque background so horizontally scrolled content cannot show through. Metric columns SHALL use an opaque pale-blue surface and starred columns SHALL use an opaque amber surface with starred emphasis taking precedence. When the pinned-width fallback disables sticky positioning, the normal non-sticky accent treatment MAY remain translucent.

The shared column order SHALL be stored in the existing Results UI preference document alongside checkbox visibility and SHALL use the existing browser/owner SQLite synchronization. It SHALL NOT modify `results.yaml`. Restoring an absent or empty order SHALL use built-in/YAML order; restoring a partial or stale order SHALL discard unknown/duplicate IDs and append newly available columns in built-in/YAML order.

Saved row-filter badges SHALL be draggable into a persistent display and evaluation order. Their visible priority SHALL match their array order. Because filters retain AND composition, reordering the same filter set MAY change short-circuit evaluation order but SHALL NOT change which rows satisfy that set.

Saved default-sort badges SHALL be draggable into a persistent priority order. The leftmost badge SHALL remain the primary comparator, subsequent badges SHALL break ties from left to right, and Variant ID SHALL remain the final tie-breaker. A successful drag SHALL clear any temporary header sort and immediately recompute row order.

#### Scenario: Checkbox drag and header drag share column order

- **GIVEN** a Results table with columns A, B, and C
- **WHEN** the user drags the complete C checkbox control before A
- **THEN** both the checkbox controls and unpinned table headers render C, A, B
- **WHEN** the user then drags header B before C
- **THEN** both surfaces render B, C, A
- **AND** refreshing restores that order and the existing checked/unchecked states

#### Scenario: Partial saved order accepts a new document column

- **GIVEN** preferences save column B before A
- **WHEN** the current `results.yaml` also introduces column C
- **THEN** B and A retain their relative order and C is appended in document order
- **AND** no stale or duplicate saved ID produces a duplicate control or table column

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
