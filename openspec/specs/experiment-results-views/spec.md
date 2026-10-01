# experiment-results-views Specification

## Purpose
Defines Results Views: named, shared arrangements of an Experiment's Results table (filters, column visibility and order, sorting, pinning, row overrides and formatting) bound to one exact Experiment identity. Owners create and edit Views, and share viewers can read every View in their scope but cannot change them. Views are owned durably by the central service's SQLite store (`apps/web/lib/server/experiment-results-views-store.ts`); the Results data itself stays in the Experiment's `results.yaml`.

## Requirements
### Requirement: Results Views are shared Experiment resources

Every durable Results table arrangement SHALL be represented as a named View bound to one exact Experiment identity. In central mode that identity SHALL include Host, Project, and Experiment; it SHALL NOT include username. All authenticated owners and exact-scope viewers reading that Experiment SHALL receive the same ordered View collection and definitions.

A View definition SHALL include persistent Experiment-local Results filters, checked/hidden columns, column order, maximum lines, default sort rules, pinning, row overrides, SOTA modes, and decimal formatting. Temporary show-all, temporary header sorting, active View selection, and Project-wide starred column labels SHALL NOT be part of the shared View definition.

#### Scenario: Two users see one Experiment collection

- **GIVEN** an Experiment has Views `Default` and `Accuracy review`
- **WHEN** two different authenticated users open that Experiment
- **THEN** both receive those same View IDs, names, order, and definitions
- **AND** no username selects or duplicates a collection

#### Scenario: Identically named Experiment on another Host is isolated

- **GIVEN** two Hosts expose the same Project and Experiment names
- **WHEN** a View is changed on the first Host's Experiment
- **THEN** the second Host's Experiment View collection is unchanged

### Requirement: Central SQLite durably owns View lifecycle

The central node SHALL persist Experiment Views in SQLite beside the active central configuration. It SHALL support listing, creating, renaming, updating the complete definition, and deleting Views. Names SHALL be bounded, trimmed, and case-insensitively unique within one Experiment. Mutations SHALL advance a monotonic revision and updated timestamp. Authenticated dynamic responses SHALL use `no-store`; Views SHALL NOT be stored on a cluster Backend or in `results.yaml`.

#### Scenario: Owner edits survive restart

- **GIVEN** an owner changes filters and checked columns in a View
- **WHEN** the asynchronous write is acknowledged and central restarts
- **THEN** the same View definition and newer revision are returned from SQLite

#### Scenario: Duplicate name is rejected only within one Experiment

- **GIVEN** one Experiment already has a View named `Review`
- **WHEN** the owner creates ` review ` on the same Experiment
- **THEN** the request fails with a conflict
- **BUT WHEN** the owner creates `Review` on another Experiment
- **THEN** it succeeds

### Requirement: View synchronization preserves causal browser-first behavior

Owner View edits SHALL update mounted UI and browser fallback storage without awaiting the server. Complete definition writes SHALL serialize per View in invocation order, survive component unmount, and remain durably dirty until the exact mutation is acknowledged. A hydration response or acknowledgement older than the latest local mutation or acknowledged server revision SHALL NOT overwrite that mutation. Failed writes SHALL remain retryable, and cross-browser convergence SHALL remain complete-snapshot last-writer-wins on a later hydration.

Active View selection SHALL be remembered only in the browser. Selecting another View SHALL not mutate either View and SHALL reset mounted-only temporary sort/show-all state.

#### Scenario: Delayed hydration cannot revert a checked column

- **GIVEN** View hydration is in flight
- **WHEN** the owner changes a column checkbox before the response arrives
- **THEN** the changed complete View remains rendered and dirty
- **AND** it is written after hydration rather than replaced by the older response

#### Scenario: Viewer changes only selection

- **GIVEN** a viewer can read two Views
- **WHEN** the viewer switches from one to the other
- **THEN** the selected definition renders
- **AND** no View mutation request is sent

### Requirement: Share viewers can read every scoped View but cannot mutate

An exact Host+Project share viewer SHALL be allowed to list and read every View for an Experiment in that scope. The same viewer SHALL receive a forbidden response for create, rename, definition update, and delete, including direct API requests. A viewer outside the exact Host+Project scope and an anonymous requester SHALL receive no View data.

#### Scenario: Shared Experiment exposes curated Views read-only

- **GIVEN** a valid share link for one Host and Project
- **WHEN** the viewer opens an Experiment with several Views
- **THEN** all of those Views are selectable and visible
- **AND** lifecycle and table-editing controls are disabled or absent
- **AND** direct mutation requests return forbidden

#### Scenario: Same Project name on another Host is not readable

- **GIVEN** a viewer is scoped to Host A and Project X
- **WHEN** the viewer requests Views for Host B and Project X
- **THEN** the request is rejected without returning collection metadata

### Requirement: Legacy Results arrangements migrate without loss

Central initialization SHALL transactionally and idempotently import legacy username-keyed Results preference rows into Experiment Views. Every canonically distinct valid definition SHALL exist as one shared View under its derived Experiment scope; canonically identical definitions MAY deduplicate. Source rows SHALL remain unchanged and recoverable, deterministic imported IDs SHALL prevent retry duplicates, and malformed or ambiguous rows SHALL remain untouched rather than being guessed.

If an owner browser has a legacy Results value for an Experiment whose server collection is empty, the client SHALL create one View from that exact value and mark migration complete only after acknowledgement. A viewer SHALL NOT import browser-local state into the shared collection.

#### Scenario: Multiple usernames have distinct legacy arrangements

- **GIVEN** two username-keyed legacy rows for the same Experiment contain different definitions
- **WHEN** migration runs
- **THEN** both definitions exist as separate shared Views
- **AND** both legacy rows remain byte-for-byte available

#### Scenario: Migration restarts safely

- **GIVEN** legacy rows were already imported
- **WHEN** central initializes again
- **THEN** no duplicate View is created
- **AND** existing imported payloads and source rows remain unchanged
