## MODIFIED Requirements

### Requirement: Results preference hydration and mutations are race-safe

The browser/SQLite Results preference state SHALL compose multiple synchronous or React-batched updates against the latest in-memory value rather than a render-time snapshot. Updating one preference field SHALL NOT erase a preceding unrendered update to another field, and repeated operations on the same collection, including hiding multiple columns or adding multiple filters, SHALL accumulate in invocation order.

The browser SHALL durably distinguish an absent local preference or unmodified initial default from a real user mutation. Only a setter whose serialized value differs from the current value SHALL create a dirty local mutation. A real mutation SHALL remain causally newer than server hydration until SQLite acknowledges that exact mutation, including when the mutation explicitly produces empty filters, no hidden columns, or another default-looking value. An absent local record, an unmodified initial default, and a same-value setter SHALL remain clean and SHALL accept a found server value.

Owner server writes SHALL update UI and browser storage without waiting, serialize complete preference snapshots in invocation order, survive component unmount, and use unload-safe requests. A failed or forbidden write SHALL NOT clear the local value or dirty marker. A later owner hydration or mutation SHALL retry dirty state. A server acknowledgement SHALL clear dirty state only when it matches the latest local mutation; an acknowledgement or hydration response older than the latest local mutation or acknowledged server revision SHALL NOT overwrite it.

Preference reconciliation SHALL preserve the distinction between a missing SQLite row, a missing browser record, and a present explicitly empty value. When SQLite has no row and browser state exists, browser state SHALL remain active and migrate to SQLite. Viewer/anonymous sessions SHALL remain browser-only. Manually refreshing Results data or receiving a document with added/removed columns SHALL normalize stale IDs without clearing valid filters, checkbox visibility, ordering, pinning, line count, row overrides, or default-sort preferences.

#### Scenario: No local record accepts the server value

- **GIVEN** the browser has no local preference record or dirty mutation
- **AND** SQLite contains a preference for the logged-in owner
- **WHEN** hydration completes
- **THEN** the SQLite value becomes the rendered and browser-stored value
- **AND** no browser default is uploaded over it

#### Scenario: Explicitly clearing filters is a real local change

- **GIVEN** the rendered preference contains one or more filters
- **WHEN** the user removes the final filter
- **THEN** the empty filter list is stored locally as a dirty mutation
- **AND** an older server filter list cannot restore itself
- **AND** the explicit empty list is uploaded to SQLite

#### Scenario: Same-value setter is not a mutation

- **GIVEN** a clean browser preference
- **WHEN** a setter produces the same serialized preference value
- **THEN** no dirty marker or server write is created
- **AND** subsequent newer server hydration may still win

#### Scenario: Failed write remains recoverable

- **GIVEN** a user mutation updated UI and localStorage
- **AND** its owner SQLite write fails
- **WHEN** the preference remounts and receives an older found server row
- **THEN** the dirty local value remains rendered
- **AND** it is retried instead of being overwritten

#### Scenario: Unmount does not discard the latest queued mutation

- **GIVEN** multiple preference mutations are queued in order
- **WHEN** the component unmounts before the earlier request completes
- **THEN** the queue continues independently of the component lifetime
- **AND** SQLite ultimately receives the latest complete preference

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

- **GIVEN** clean or legacy browser storage contains filters without a dirty user mutation
- **AND** SQLite contains a present preference whose filter list is explicitly empty
- **WHEN** hydration completes without user interaction
- **THEN** the empty server filter list replaces the browser filters
