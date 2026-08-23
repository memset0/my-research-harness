## Why

Results filters and checkbox visibility can appear to save and then revert. Two stale-write races cause this: a delayed SQLite hydration response can overwrite an interaction performed while that request was pending, and component updates rebuild the complete preference object from render-time values so batched/rapid operations can overwrite one another.

## What Changes

- Make the shared browser/SQLite preference hook accept functional updates resolved synchronously against its latest in-memory value.
- Treat user interaction that occurs after a server hydration request begins as newer than that response; preserve it and migrate the latest value back to SQLite.
- Refactor Results preference mutations to merge atomically rather than replace from render-time snapshots.
- Add deterministic regressions for delayed server hydration, batched field changes, rapid checkbox changes, filters, explicit empty state, and Results data refresh.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-dashboard`: guarantee race-safe Results preference hydration and mutation.

## Impact

- `apps/web/lib/use-user-preference-state.ts`: functional updater and hydration ordering.
- `apps/web/components/experiment-results-table.tsx`: atomic preference mutations.
- Hook and Results table regressions only; no preference key, JSON schema, SQLite table, or `results.yaml` changes.
