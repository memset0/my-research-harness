## MODIFIED Requirements

### Requirement: Results Views are shared Experiment resources

Every durable Results table arrangement SHALL be represented as a named View bound to one exact Experiment identity. In central mode that identity SHALL include Host, Project, and Experiment; it SHALL NOT include username. All authenticated owners and exact-scope viewers reading that Experiment SHALL receive the same ordered View collection and definitions.

A View definition SHALL include persistent Experiment-local Results filters, the checked state of column-tree nodes, the tree order, collapsed groups, pinned columns and their order, maximum lines, default sort rules, row overrides, SOTA modes, decimal formatting, and, for `stats` columns, the selected display (one vocabulary statistic or one display template) and the statistic used for sorting, filtering and SOTA. Columns SHALL be identified by their result path. Temporary show-all, temporary header sorting, active View selection, and Project-wide starred column labels SHALL NOT be part of the shared View definition.

#### Scenario: Two users see one Experiment collection

- **GIVEN** an Experiment has Views `Default` and `Accuracy review`
- **WHEN** two different authenticated users open that Experiment
- **THEN** both receive those same View IDs, names, order, and definitions
- **AND** no username selects or duplicates a collection

#### Scenario: Identically named Experiment on another Host is isolated

- **GIVEN** two Hosts expose the same Project and Experiment names
- **WHEN** a View is changed on the first Host's Experiment
- **THEN** the second Host's Experiment View collection is unchanged

#### Scenario: Stats display is part of the View

- **GIVEN** an owner sets the latency column of a View to display the outer `p99` of the inner `max` and to sort by it
- **WHEN** another user selects that View
- **THEN** the latency cells show that statistic and the rows are ordered by it

### Requirement: View definitions share one validation contract

The dashboard SHALL validate the Results View definition shape through one
contract used both at the View API boundary and when a View is rendered.

At the API boundary, a create or update request SHALL be rejected as a bad
request unless its definition contains every persistent field with its
documented type and: a positive integer maximum line count; decimal places that
are integers from 0 through 10; row filters and default sort rules that each
carry a unique string ID; at most one default sort rule per column; no
duplicate column ID within the column order or the hidden-column list; no
column pinned more than once, on either side; and every stats display or sort
selection naming a statistic built from the fixed statistic vocabulary defined
by `run-results` or one of the display templates. Column, Variant and filter values are not checked against the current
Results definition at this boundary.

When a stored View is rendered against the current Results summary, entries
that only reference a column or Variant absent from that summary SHALL be
dropped without a notice, as the Results preference requirements already
specify for stale IDs, after legacy column identifiers have been resolved as
the legacy-identifier requirement specifies. A stats selection naming a
statistic the column does not carry SHALL fall back to the column's default
display without a notice. A filter or sort rule whose ID is missing or
duplicated SHALL be kept with a newly assigned ID rather than dropped. Any
other entry that does not satisfy the contract SHALL be ignored for rendering,
and the Results table SHALL show a visible note stating how many saved View
settings were ignored as invalid; the table SHALL NOT silently discard them.

#### Scenario: The API rejects a definition the UI cannot produce
- **GIVEN** an owner submits a View definition whose decimal places for a column are `12`
- **WHEN** the View update request is processed
- **THEN** the request fails as a bad request
- **AND** the stored View is unchanged

#### Scenario: Duplicate sort columns are rejected
- **GIVEN** a submitted View definition with two default sort rules for the same column
- **WHEN** the View create request is processed
- **THEN** the request fails as a bad request

#### Scenario: Unknown statistic is rejected
- **GIVEN** a submitted View definition whose stats display for a column is `median`
- **WHEN** the View update request is processed
- **THEN** the request fails as a bad request

#### Scenario: A stale column reference is cleaned silently
- **GIVEN** a stored View hides column `schema:metrics.old`
- **AND** the current Results definition no longer declares that column
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

## ADDED Requirements

### Requirement: Legacy flat column identifiers resolve to result paths

A stored View that references a column by a pre-v9 flat key (`schema:<key>`) SHALL, at render time, refer to the column whose result path is the parameter or metric path that the v8-to-v9 migration produced for that key, when exactly one such column exists; the stored definition SHALL keep the legacy identifier until an owner's next save of that View, which SHALL persist the path identifier. A legacy key that matches no column or more than one SHALL be treated as a stale reference. No View row SHALL be rewritten by the filesystem migration.

#### Scenario: A View survives the migration
- **GIVEN** a View that hides `schema:lr` and sorts by `schema:fid`, saved before the Experiment was migrated so that `lr` became `params.lr` and `fid` became `metrics.fid`
- **WHEN** the migrated Experiment's Results table renders the View
- **THEN** the `params.lr` column is hidden and the rows are sorted by `metrics.fid`
- **AND** the stored View is unchanged until an owner saves it, after which it references the paths
