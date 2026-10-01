## Context

See proposal.md (Why). The Results table is rendered by
`components/experiment-results-table.tsx` from a normalized
`ResultsDocument`; its persistent arrangement is a shared View managed by
`lib/use-experiment-results-views.ts` (browser-first, SQLite-backed). The API
routes under `app/api/experiment-results-views/**` validate submitted
definitions with `isExperimentResultsViewDefinition` imported from
`lib/experiment-results-views.ts`; that import path must keep working because
those routes and `lib/server/**` are outside this change.

The behavioral safety net is `components/experiment-results-table.test.tsx`
(15 interaction tests). Their assertions keep their meaning throughout.

## Goals / Non-Goals

**Goals:**
- Every React-free function is exported from `lib/experiment-results/` and has
  table-driven unit tests (empty table, missing column, mixed types, NaN,
  duplicate rows).
- One View-definition validation module; differences resolved explicitly.
- Container ≤ 500 lines; every subcomponent file ≤ 400 lines; props typed
  explicitly (no whole-state pass-through).

**Non-Goals:**
- No change to `results.yaml`, the CLI, the View API routes or store, the
  View synchronization hook, or the `/p` and `/h` page trees.
- No visual redesign. DOM may be regrouped, but `data-slot`, `data-*` hooks,
  ARIA attributes and keyboard interaction stay.

## Decisions

### D1 Module layout (`apps/web/lib/experiment-results/`)

| Module | Contents |
|---|---|
| `types.ts` | `ResultValue`, `ColumnKind`, `ResultTableColumn`, drag/pin/SOTA types |
| `columns.ts` | `buildColumns`, `excludedRunIds`, `arrangeColumns` (ordered / visible / pinned grouping), `distinctValues`, `resultValueDescription` |
| `format.ts` | `valueText`, `displayText`, `plainCellValue`, `isEmptyValue`, `formatScalar` (decimal places), `splitDisplayLines`, `parseWandbUrl`, `gitBlobUrl`, `gitCommitUrl`, operator/sort/SOTA label helpers |
| `filters.ts` | `filterVariants`, `matchesRowFilter`, `compareFilterValues` |
| `sorting.ts` | `effectiveSortRules`, `sortVariants`, `compareSortValues` |
| `sota.ts` | `computeSotaRanks`, `nextSotaMode` |
| `layout.ts` | `reorderIds`, `reorderItems`, `dropEdgeAt`, pin layout helpers |
| `definition-edits.ts` | pure `(definition, …) => definition` edits used by the container (hide, pin, reorder, filters, sorts, overrides, SOTA, decimals) and `isPristineView` |
| `transient-state.ts` | reducer for mounted-only state |
| `views.ts` | View types, scope helpers, the merged validator (D2) |

Alternatives: keeping helpers in the component file but exported — rejected,
the file would stay a client module pulling React and shadcn into pure tests.

### D2 One validation module

`views.ts` defines element predicates (`isSortDirection`,
`isRowFilterOperator`, `isRowOverride`, `isSotaMode`, `isMaxLines`,
`isDecimalPlaces`) used by both entry points:

- `isExperimentResultsViewDefinition(value)` — strict, document-agnostic, for
  the API boundary.
- `normalizeResultsViewDefinition(value, columnIds, variantIds)` — returns
  `{ definition, invalidCount }` for rendering.

`lib/experiment-results-views.ts` becomes `export * from
'./experiment-results/views'`.

Behavior differences found between the two former validators and the choice
taken (spec = `experiment-results-views` / `web-dashboard` Results
requirements):

| # | Field / case | Old strict `valid*` | Old component `normalize*` | Chosen | Basis |
|---|---|---|---|---|---|
| 1 | Unknown column / Variant IDs | accepted | dropped silently | strict: accept; normalize: drop silently | spec: stale IDs normalized without clearing valid prefs |
| 2 | Duplicate `columnOrderIds` | accepted | deduped | strict: reject; normalize: dedupe silently | spec: discard duplicate IDs; UI never emits duplicates |
| 3 | Duplicate `hiddenColumnIds` | accepted | kept (duplicates) | strict: reject; normalize: dedupe | stricter, no data lost |
| 4 | Column pinned twice / both sides | accepted | first occurrence kept (left wins) | strict: reject; normalize: keep first, count invalid | stricter; surfaced |
| 5 | Two sort rules on one column | accepted | first kept | strict: reject; normalize: keep first, count invalid | spec: each badge selects a unique column |
| 6 | Sort/filter entry without string `id` | rejected | kept, id synthesized | strict: reject; normalize: keep with new id | do not drop rows of configuration |
| 7 | Duplicate sort/filter `id` | accepted | kept (React key clash) | strict: reject; normalize: keep with new id | stricter; no data lost |
| 8 | `maxLines` non-integer / < 1 | rejected | floored, min 1 | strict: reject; normalize: floor/clamp | spec: positive line count |
| 9 | `decimalPlaces` outside 0–10 or fractional | accepted (any finite) | fractional floored; out of range dropped | strict: integer 0–10; normalize: floor in-range, drop + count invalid otherwise | UI domain 0–10; stricter; surfaced |
| 10 | `sotaModes` value `off` | accepted | dropped (same as absent) | both unchanged | equivalent meaning |
| 11 | Malformed operator / direction / override / SOTA value | rejected | dropped silently | strict: reject; normalize: drop + count invalid | user rule: mark invalid, don't drop silently |
| 12 | Missing top-level field / non-object | rejected | default for that field | unchanged | lenient render keeps legacy partial definitions usable |

`invalidCount > 0` renders a `role="note"` line in the Results controls:
"N saved View setting(s) are invalid and ignored." Stale-ID drops (row 1–3)
are not counted.

### D3 Component split and state

`components/results-table/`: `view-switcher.tsx` (select + create / rename /
delete dialogs, owns its dialog state), `column-toolbar.tsx` (counts, show-all,
max lines, reset confirmation), `column-options.tsx` (checkbox chips with
domain hover), `filter-bar.tsx` (rows summary, filter and sort badge lists),
`row-filter-badge-editor.tsx`, `sort-badge-editor.tsx`, `column-header.tsx`
(header cell + context menu), `result-row.tsx` (row + override menu),
`cells.tsx` (`ResultCell` dispatch to `VariantCell`, `StatusCell`,
`RunListCell`, `ProvenanceCell`, `ScalarCell`; `CellClamp`),
`annotation-tooltip.tsx`, `results-grid.tsx` (table + pin layout),
`use-pin-layout.ts`, `drag.ts` (typed drag handler bundle).

State: of the 20 `useState` hooks, the coupled mounted-only state —
`showAllColumns`, `showAllRows`, `temporarySort`, `draggedItem`, `dropTarget`
— moves into one `useReducer` (`transient-state.ts`); selecting, creating or
deleting a View and resetting dispatch one `reset` instead of three setters.
Dialog/editor state (`viewEditorOpen/Mode/Name`, `viewMutationPending`,
`deleteViewDialogOpen`, `resetDialogOpen`) moves into the component that owns
the dialog. `pinLayout` moves into `use-pin-layout.ts`. The persistent
definition stays in `useExperimentResultsViews`; the container applies
`definition-edits.ts` functions through one `edit(fn)` that re-normalizes the
latest stored value (preserving the race-safe composition the spec requires).

Incidental fix: the SOTA submenu items previously all called a cycle, so
choosing `Lower is better` from `Off` selected `Higher is better`. Each item now
sets its own mode. Unused `SotaModeToggle` / `DecimalPlacesInput` are deleted.

### D5 Query keys

`inbox-shell.tsx` invalidated `queryKeys.reportsRawTarget(project)` =
`['reports', {host, project}]` while the list reads
`queryKeys.reports(project)` = `['reports', host, project]`. It now invalidates
`queryKeys.reports(project)`, and `reportsRawTarget` (no other caller) is
removed together with its snapshot. `gitCommit` (`[…, submodule, sha]`, read by
the history dialog) and `gitCommitAtRoot` (`[…, sha]`, read by the wiki review
panel) both have live readers and no invalidations target them; they stay as
is.

## Risks / Trade-offs

- [Stricter API guard rejects a payload a client used to send] → the UI only
  writes normalized definitions, which satisfy the strict guard (unit-tested
  property: normalize output is strictly valid); the error surfaces through the
  existing View error text and the browser copy is kept.
- [Refactor regresses an interaction] → the 15 existing tests stay unchanged in
  meaning and run after every commit; new subcomponent render tests pin
  `data-slot` and key text.
- [Large diff in a file other agents may touch] → ownership is limited to
  `components/**`, `lib/experiment-results*`, `lib/query-keys.ts`, `hooks/**`.

## Migration Plan

Web-only; ships with the next central PATCH release. Rollback is a revert of
the change's commits; stored Views are unaffected.

## Future

- Move `lib/use-experiment-results-views.ts` under `lib/experiment-results/`
  and have it normalize before seeding/duplicating Views.
- Consider virtualizing rows for very large Results documents.
- Share the drag-reorder helper with other draggable badge lists.
