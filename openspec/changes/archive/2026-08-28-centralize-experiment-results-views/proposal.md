## Why

The Results table currently stores one mutable preference snapshot per username and Experiment. That model cannot represent multiple useful arrangements, makes otherwise identical users see different state, and prevents read-only share users from seeing the arrangements curated by the owner. Existing browser-first synchronization also leaves the durable record shaped as a generic UI preference instead of an Experiment Results resource.

## What Changes

- Define every saved combination of Results filters, visible-column checkboxes, ordering, sorting, pinning, row overrides, and display formatting as an Experiment-bound **View**.
- Persist the shared View collection in the central node's SQLite database, keyed by exact Host, Project, and Experiment identity and never by username.
- Add a central-owned View API: owners can list, create, rename, update, and delete Views; exact-scope share viewers can list and read every View for the shared Experiment but cannot mutate them.
- Keep active View selection client-local while preserving the existing browser-first, ordered, last-writer synchronization behavior for owner edits.
- Transactionally import legacy username-keyed Results preference rows into shared Experiment Views without deleting the legacy source rows, and import a browser-only legacy value when the owner reaches an Experiment with no server View.
- Keep Project-wide starred column labels outside the Experiment View model.

## Capabilities

### New Capabilities

- `experiment-results-views`: Defines Experiment ownership, shared central persistence, View lifecycle, synchronization, authorization, and lossless legacy import.

### Modified Capabilities

- `web-dashboard`: Results controls select and edit named Experiment Views instead of one username-keyed preference snapshot.
- `auth-system`: Exact-scope share viewers may read central View collections while all View mutations remain owner-only.

## Impact

- Affects the central Web runtime, its SQLite schema, the Results table client state, route ownership/auth classification, and focused Web tests.
- Does not change Backend protocol or cluster filesystem data. Concrete deployment topology, credentials, and database paths remain machine-local configuration.
- This is a central-only Web change under the established release policy and therefore advances the Patch version unless another separately released change requires a larger component.
