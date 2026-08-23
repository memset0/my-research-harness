## Why

Results filters and checkbox/sort preferences can still revert after appearing to save. Browser updates are immediate, but a queued SQLite write can be skipped on unmount or fail once and stop syncing; the next mount then lets an older found SQLite row overwrite the newer browser value. The browser currently records no durable evidence that a value came from a real, unsynchronized user change.

## What Changes

- Persist separate local sync metadata that marks only value-changing user actions as dirty.
- Let a dirty local value override a found but older server snapshot and migrate it to SQLite, including when the user explicitly cleared filters to an empty array.
- Keep an absent local record, an unmodified initial default, and a same-value setter clean so a found server value can hydrate them.
- Keep ordered server writes alive across component unmounts, use request keepalive, and clear dirty state only when the matching write is acknowledged.
- Retain dirty state after network/server failures so later interaction or remount retries without losing the local value.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-dashboard`: make browser/SQLite preference reconciliation causally respect durable user changes.

## Impact

- `apps/web/lib/use-user-preference-state.ts` and its focused tests.
- Existing preference values and SQLite schema remain compatible; sync metadata stays browser-local under a separate key.
- No `results.yaml`, authentication, or table component schema changes.
