## Why

Results tables mix experiment parameters with measured metrics, but the current presentation makes the two groups visually indistinguishable. A literal `Metric` badge and value-domain hover would add noise and expose a preview that is not useful for metric columns.

## What Changes

- Give `group: metric` column controls, table headers, and body cells a restrained pale-blue treatment.
- Keep metric controls compact without a redundant `Metric` badge.
- Suppress value-domain hover previews for metrics while retaining their distinct-value count.
- Preserve value-domain previews for parameter and metadata columns.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-dashboard`: define the visual and hover behavior for metric Results columns.

## Impact

- `apps/web/components/experiment-results-table.tsx`: metric styling and conditional value-domain preview.
- `apps/web/components/experiment-results-table.test.tsx`: metric/parameter rendering regressions.
- No Results schema, persistence format, filtering, sorting, or server behavior changes.
