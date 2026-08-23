## Why

Results are projected from `results.yaml`, which often changes while an Experiment page remains open. Readers currently have to reload the entire page to see those changes, disrupting unrelated document sections, Run panels, and local interaction state, while the UI gives no indication of how old the visible Results snapshot is.

## What Changes

- Add a dedicated read-only endpoint that reparses the current Experiment's `results.yaml` directly from disk and returns only its normalized Results document plus source/snapshot timestamps.
- Add a Refresh action to the Results card that replaces only the rendered Results snapshot.
- Show the `results.yaml` last-modified time and a live `stale for` duration for the currently displayed snapshot.
- Preserve the last good Results data and display a local error when refresh fails or the current YAML is invalid.
- Preserve page-level state, other document sections, Run panels, and Results UI preferences during refresh.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-dashboard`: define isolated Results refresh, timestamp, staleness, and failure behavior.

## Impact

- `apps/web/app/api/experiments/[id]/results/route.ts`: fresh Results snapshot endpoint.
- `apps/web/app/api/experiments/[id]/route.ts`: initial Results source/snapshot timestamps.
- `apps/web/lib/api.ts`: Results snapshot API contract.
- `apps/web/components/experiment-page.tsx`: Results-only refresh controls and status.
- Route and browser regressions; no write path or `results.yaml` mutation.
