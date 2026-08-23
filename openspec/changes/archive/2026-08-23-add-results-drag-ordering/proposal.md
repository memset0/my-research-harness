## Why

Results preferences currently preserve visibility, filtering, pinning, and sort rules, but column order can only follow the document/pin groups and ordered rules require editor buttons. Dense experiment tables need direct spatial reordering from the controls people are already using.

## What Changes

- Allow every Results column to be reordered by dragging either its checkbox control or its table header.
- Keep both column surfaces synchronized and persist one shared column order beside the existing visibility preference, never in `results.yaml`.
- Allow saved row-filter badges to be dragged into a persistent evaluation/display order.
- Allow default-sort badges to be dragged so their left-to-right order directly controls sort priority and the resulting row order.
- Preserve pin-side grouping while applying the shared column order within each pinned/unpinned group.
- Keep sticky pinned headers and cells fully opaque, including metric and starred accent variants, so scrolled content cannot show through.
- Remove redundant instructional paragraphs above the Results table.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-dashboard`: add persistent drag ordering to Results columns, row filters, and default-sort rules.

## Impact

- `apps/web/components/experiment-results-table.tsx`: drag state, ordering normalization, persistence, and synchronized rendering.
- `apps/web/components/experiment-results-table.test.tsx`: drag ordering and refresh regressions.
- Existing browser/SQLite preference transport is reused; `results.yaml` and its schema remain unchanged.
