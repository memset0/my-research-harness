## Why

`datatable@1` plot views start the y axis at zero (the chart library default) and lay numeric `x` values out as evenly spaced categories, so a series whose values sit close together (0.061 … 0.087) renders as a flat line and a sweep at steps 1000/2000/10000 is drawn with equal gaps. The hover tooltip also prints values through `toLocaleString()`, which rounds a measured `0.0612345` to `0.061` — a document whose whole point is the numbers must never show a different number than the one declared.

## What Changes

- Plot views fit both axes to the data by default: the y domain spans the plotted values, and when every `x` cell is numeric a `line` view uses a true numeric x axis spanning the values. Two optional view flags, `x_from_zero` and `y_from_zero`, restore a zero-anchored axis on request. `bar` views keep a categorical x axis (`x_from_zero` has no effect there).
- Tooltips print the raw cell text of every plotted value and of the hovered x, never a locale-rounded rendering.
- The `memon-components` skill table and field docs regenerate from the descriptor (`views` description mentions the flags). Distributed artifact (skills) changes → MINOR release.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `document-components`: the `datatable@1` requirement gains axis-domain and raw-value rendering rules.

## Impact

- `apps/web/lib/components/datatable/v1/{index.ts,series.ts,plot.tsx}` and their tests; generated `packages/skills/memon-components/SKILL.md` field table (via `scripts/component-docs.mjs --write`).
- No storage, CLI, or API surface changes; existing blocks keep validating (new fields are optional).
