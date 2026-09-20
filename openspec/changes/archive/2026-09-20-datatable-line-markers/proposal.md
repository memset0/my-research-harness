## Why

`datatable@1` line views draw only the interpolated line (`dot={false}`), so a reader cannot tell where the measured points are — a sweep with three observations looks like a continuous curve.

## What Changes

- Every `line` view marks each plotted data point with a visible dot on the line by default; the hovered point is enlarged. No new payload field.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `document-components`: the `datatable@1` requirement states that line views mark every data point.

## Impact

- `apps/web/lib/components/datatable/v1/plot.tsx`. Central-only (no CLI/skills text change: the field table is unchanged) → PATCH release.
