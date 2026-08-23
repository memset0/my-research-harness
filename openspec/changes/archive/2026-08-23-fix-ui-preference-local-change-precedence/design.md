## Context

The preference hook stores raw JSON in localStorage and mirrors it to an owner-only SQLite row. A found server row currently wins on every uncontested mount. Server writes are tied to one mounted hook generation, and one failed write disables further server synchronization for that mount. Consequently a locally newer value has no durable causal marker and can be replaced by stale SQLite data.

## Goals / Non-Goals

**Goals:**

- Distinguish no local preference from an explicit user change whose resulting value may be empty.
- Preserve locally newer changes until the exact value is acknowledged by SQLite.
- Allow a clean browser cache to accept server hydration.
- Preserve the latest complete queued value across unmount and transient failure.

**Non-Goals:**

- Change the SQLite table or place sync metadata in the server value.
- Treat render-time defaults or same-value setters as user changes.
- Merge individual fields edited concurrently on unrelated devices.

## Decisions

### 1. Store a separate browser sync envelope

The existing localStorage value remains unchanged for compatibility. A companion key stores schema version, a unique mutation ID, dirty state, and the last acknowledged server timestamp. Only a setter whose serialized next value differs from the current value creates a mutation ID and marks dirty. Hydration and defaults never do so.

### 2. Reconcile by causal state before location

A present dirty marker plus a present local value is proof of a user change, so local wins and is uploaded even when its filters are explicitly empty. Without a local record, or with a clean/legacy local value, a found non-stale server row wins. A server response older than the last acknowledged server timestamp cannot undo the acknowledged local value.

### 3. Make writes independent of React lifetime

A module-level per-key queue serializes complete snapshots and uses `fetch(..., { keepalive: true })`. Unmount does not invalidate queued writes. An acknowledgement clears dirty only when its mutation ID still matches localStorage; a newer mutation remains dirty. Failed requests leave the durable marker intact and are retried by later changes or hydration.

## Risks / Trade-offs

- Companion metadata adds one localStorage entry per preference key.
- Legacy browser values have no proof of unsynchronized user origin and therefore remain clean; a found server row wins once, matching prior behavior.
- A viewer/anonymous browser can accumulate dirty local state. It remains browser-only while unauthorized and can migrate if that same browser later becomes the owner.
