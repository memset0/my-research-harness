## ADDED Requirements

### Requirement: View definitions share one validation contract

The dashboard SHALL validate the Results View definition shape through one
contract used both at the View API boundary and when a View is rendered.

At the API boundary, a create or update request SHALL be rejected as a bad
request unless its definition contains every persistent field with its
documented type and: a positive integer maximum line count; decimal places that
are integers from 0 through 10; row filters and default sort rules that each
carry a unique string ID; at most one default sort rule per column; no
duplicate column ID within the column order or the hidden-column list; and no
column pinned more than once, on either side. Column, Variant and filter values
are not checked against the current `results.yaml` at this boundary.

When a stored View is rendered against the current Results document, entries
that only reference a column or Variant absent from that document SHALL be
dropped without a notice, as the Results preference requirements already
specify for stale IDs. A filter or sort rule whose ID is missing or duplicated
SHALL be kept with a newly assigned ID rather than dropped. Any other entry
that does not satisfy the contract SHALL be ignored for rendering, and the
Results table SHALL show a visible note stating how many saved View settings
were ignored as invalid; the table SHALL NOT silently discard them.

#### Scenario: The API rejects a definition the UI cannot produce
- **GIVEN** an owner submits a View definition whose decimal places for a column are `12`
- **WHEN** the View update request is processed
- **THEN** the request fails as a bad request
- **AND** the stored View is unchanged

#### Scenario: Duplicate sort columns are rejected
- **GIVEN** a submitted View definition with two default sort rules for the same column
- **WHEN** the View create request is processed
- **THEN** the request fails as a bad request

#### Scenario: A stale column reference is cleaned silently
- **GIVEN** a stored View hides column `schema:old`
- **AND** the current `results.yaml` no longer declares that column
- **WHEN** the Results table renders the View
- **THEN** the hidden-column entry is ignored
- **AND** no invalid-settings note is shown

#### Scenario: A malformed stored entry is surfaced
- **GIVEN** a stored View contains a row filter whose operator is not one of equals, does-not-equal, greater-than or less-than
- **WHEN** the Results table renders the View
- **THEN** that filter does not affect the rows
- **AND** the table shows a note that one saved View setting was ignored as invalid

#### Scenario: A filter without an ID is kept
- **GIVEN** a stored View contains a valid row filter that has no ID
- **WHEN** the Results table renders the View
- **THEN** the filter applies to the rows and renders as a filter badge
