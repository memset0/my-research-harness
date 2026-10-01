## Why

`apps/web/components/experiment-results-table.tsx` is a ~2,900-line file whose
main component (~1,400 lines, 20 `useState` hooks) mixes data shaping, View
editing, drag-and-drop, dialogs and cell rendering. Its filter/sort/SOTA/format
logic is private and only reachable through slow full-component tests, and the
View-definition shape is validated twice: leniently by private `normalize*`
helpers in the component and strictly by `isExperimentResultsViewDefinition` in
`lib/experiment-results-views.ts`, with silent behavioral differences between
the two. Separately, the Inbox Report editor invalidates the Report list with a
legacy key (`['reports', project]` embedding the raw target) that does not
prefix-match the list read for a Host-qualified Project, so a central-mode save
never refreshes the list.

## What Changes

- Move every React-free Results-table function (column derivation, value
  formatting, row filtering, sorting, SOTA ranking, reordering/pin layout, View
  definition edits) into `apps/web/lib/experiment-results/` as exported,
  table-tested modules.
- Merge the two View-definition validators into one module
  (`lib/experiment-results/views.ts`) built on shared element predicates:
  a strict structural guard for the API boundary and a document-aware
  normalizer for rendering. `lib/experiment-results-views.ts` remains as a
  re-export so existing imports keep working.
- Tighten the strict guard to the shape the UI can actually produce (integer
  decimal places 0–10, unique sort columns, unique filter/sort IDs, no duplicate
  or doubly-pinned column IDs). The normalizer keeps spec-mandated stale-ID
  cleanup silent, repairs missing/duplicate entry IDs instead of dropping them,
  and reports malformed entries it ignores so the table shows a visible note
  instead of silently discarding them.
- Split the component into a container (data/state orchestration, transient UI
  state in one `useReducer`) plus `components/results-table/` subcomponents
  (View switcher, column toolbar and options, filter bar, badge editors, column
  header, row, cells). No subcomponent exceeds 400 lines; the container stays
  under 500. Existing `data-slot`, ARIA attributes and keyboard behavior stay.
- Fix the SOTA context menu so `Off` / `Higher is better` / `Lower is better`
  select that mode directly instead of all advancing a cycle; remove unused
  dead helpers (`SotaModeToggle`, `DecimalPlacesInput`).
- Invalidate the Inbox Report list with `queryKeys.reports(project)`, the same
  constructor the list read uses, and remove the legacy `reportsRawTarget`
  constructor.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `experiment-results-views`: adds one validation contract for View
  definitions (strict API guard + document-aware normalizer sharing
  predicates; malformed entries surfaced, not silently dropped).
- `live-updates`: the query-key factory requirement gains a scenario that a
  write for a Host-qualified Project invalidates its list read.

## Impact

- Web only (central surface): `apps/web/components/experiment-results-table.tsx`,
  new `apps/web/components/results-table/**`, new
  `apps/web/lib/experiment-results/**`, `apps/web/lib/experiment-results-views.ts`
  (re-export), `apps/web/lib/query-keys.ts`, `apps/web/components/inbox-shell.tsx`
  and their tests.
- The `/api/experiment-results-views` routes import the tightened guard
  unchanged by path; they now reject definitions the UI never produces.
- No `results.yaml` schema, CLI, skill, filesystem or `/p`–`/h` page-tree change.
