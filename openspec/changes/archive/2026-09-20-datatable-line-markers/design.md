## Context

`plot.tsx` renders recharts `<Line dot={false} />`. recharts draws a marker per datum when `dot` is enabled and an enlarged marker on hover through `activeDot`.

## Decisions

1. `dot={{ r: 3, strokeWidth: 0, fill: <series colour> }}` and `activeDot={{ r: 5 }}` on every series line; dots take the series colour so multi-series plots stay distinguishable.
2. No opt-out flag: the markers are the evidence; a document that wants a smooth curve is describing a fit, not measurements.
3. Spec: one sentence in the `datatable@1` requirement; skill table unchanged (descriptor text unchanged), `component-docs --check` must still pass.
