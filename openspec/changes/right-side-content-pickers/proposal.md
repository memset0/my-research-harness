## Why

On desktop, the Report and Wiki pickers sit on the left of the reading surface. The owner wants the document to lead from the left edge and the picker to sit on the right, consistent with the mobile list, which already opens from the right.

## What Changes

- The desktop Report picker rail moves from the left to the right of the reading pane. In edit mode the order becomes rendered Report, editor, rail.
- The desktop Wiki page rail moves from the left to the right edge. The reading document and its outline stay centered as one group in the remaining space; in edit mode the editor stays immediately right of the rendered page, before the rail.
- The rails' border sits on their inner (left) edge, and the hide/show controls use right-panel icons. Behaviour, widths, ordering, persistence of the hidden state and the mobile Sheet are unchanged.
- The category, freshness and presentation filters shared by both rails (and the mobile list Sheet) render as one compact row of three equal selects instead of three stacked full-width selects. Each select shows a distinguishing icon and its current value (`All` when unfiltered); its accessible name and tooltip still name the filter. The options and filtering semantics are unchanged.

## Capabilities

### New Capabilities

### Modified Capabilities
- `inbox-viewer`: "Desktop Report inbox layout" places the list rail on the right; a new requirement defines the compact icon filter row.
- `wiki-viewer`: "Desktop wiki layout" places the page list on the right of the reading surface and outline; a new requirement defines the compact icon filter row.

## Impact

`apps/web/components/inbox-shell.tsx`, `apps/web/components/wiki-shell.tsx`, `apps/web/components/content-presentation.tsx` (`ContentFilters`) and their component tests. Central Web only: PATCH release, no CLI or skills change.
