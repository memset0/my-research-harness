## Why

The Results card currently labels time since the page fetched its snapshot as `Stale for`. That is not the requested freshness measure: refreshing unchanged data incorrectly resets the counter even though the backend Results content is just as old.

## What Changes

- Compute `Stale for` from the server-observed `results.yaml` last-modified time.
- Keep the counter unchanged across a successful Refresh when backend Results did not change.
- Let a changed backend mtime update both Last updated and Stale for together.
- Remove the redundant snapshot-read timestamp from the Results API and client contract.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-dashboard`: correct Results staleness to represent backend content age rather than page snapshot age.

## Impact

- Results detail/snapshot API response timestamps.
- Results status rendering and focused route/browser tests.
- No refresh trigger, polling, persistence, or YAML behavior changes.
