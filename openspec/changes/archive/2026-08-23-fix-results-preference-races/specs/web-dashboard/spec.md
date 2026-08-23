## ADDED Requirements

### Requirement: Results preference hydration and mutations are race-safe

The browser/SQLite Results preference state SHALL compose multiple synchronous or React-batched updates against the latest in-memory value rather than a render-time snapshot. Updating one preference field SHALL NOT erase a preceding unrendered update to another field, and repeated operations on the same collection, including hiding multiple columns or adding multiple filters, SHALL accumulate in invocation order.

A present SQLite row SHALL remain authoritative over browser state when hydration completes without intervening user interaction, including when it explicitly stores empty filters or no hidden columns. If the user changes any preference after the hydration GET begins and before it resolves, that interaction SHALL be treated as causally newer than the response: the latest complete local value SHALL remain rendered and in localStorage and SHALL be enqueued to SQLite after server persistence is enabled. The same rule SHALL apply whether the response reports a found row or a missing row.

Preference reconciliation SHALL preserve the distinction between a missing SQLite row and a present explicitly empty value. Viewer/anonymous sessions SHALL remain browser-only. Manually refreshing Results data or receiving a document with added/removed columns SHALL normalize stale IDs without clearing valid filters, checkbox visibility, ordering, pinning, line count, row overrides, or default-sort preferences.

#### Scenario: Delayed server row cannot revert a new checkbox action

- **GIVEN** Results hydration requested a found SQLite preference
- **AND** the user changes a checkbox before that request resolves
- **WHEN** the older response arrives
- **THEN** the checkbox remains in the user-selected state locally
- **AND** the latest complete preference is written back to SQLite

#### Scenario: Batched filter and checkbox changes compose

- **GIVEN** a mounted Results table
- **WHEN** one task adds a row filter and hides two columns before React renders again
- **THEN** the stored preference contains the filter and both hidden-column IDs
- **AND** remounting restores all three changes

#### Scenario: Uncontested explicit empty server state stays authoritative

- **GIVEN** browser storage contains filters
- **AND** SQLite contains a present preference whose filter list is explicitly empty
- **WHEN** hydration completes without user interaction
- **THEN** the empty server filter list replaces the browser filters
