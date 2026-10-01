## 1. Pure logic (D1)

- [x] 1.1 Create `apps/web/lib/experiment-results/{types,columns,format,filters,sorting,sota,layout}.ts` with the component's React-free helpers, exported
- [x] 1.2 Add table-driven unit tests for each module (empty table, missing column, mixed types, NaN, duplicate rows)
- [x] 1.3 Make `experiment-results-table.tsx` import the modules; existing 15 table tests pass

## 2. Merged validation (D2)

- [x] 2.1 Create `lib/experiment-results/views.ts` (types, scope helpers, shared predicates, strict guard, normalizer with invalid count); turn `lib/experiment-results-views.ts` into a re-export
- [x] 2.2 Unit-test every row of the design difference table, including "normalize output satisfies the strict guard"
- [x] 2.3 Use the normalizer in the table and render the invalid-settings note; table test for the note

## 3. Container and subcomponents (D3)

- [ ] 3.1 Add `definition-edits.ts` and `transient-state.ts` with unit tests
- [ ] 3.2 Extract cells, annotation tooltip, badge editors, column header, row, grid and pin-layout hook into `components/results-table/`
- [ ] 3.3 Extract view switcher, column toolbar, column options and filter bar; container uses `useReducer` and stays ≤ 500 lines, every subcomponent ≤ 400 lines
- [ ] 3.4 SOTA submenu sets the chosen mode directly; delete dead helpers
- [ ] 3.5 Add subcomponent render tests asserting `data-slot` and key text

## 4. Query keys (D5)

- [ ] 4.1 Invalidate the Inbox Report list with `queryKeys.reports(project)`; remove `reportsRawTarget` and its snapshot
- [ ] 4.2 Test that saving a Report of a Host-qualified Project refetches the list

## 5. Verification

- [ ] 5.1 `pnpm --filter @memon/web typecheck`, Biome on touched files, `pnpm --filter @memon/web test`
- [ ] 5.2 `pnpm --filter @memon/web build` in the checkout (not a live build output)
- [ ] 5.3 F1: temporary mock copy + temporary config on a free port; grep the Experiment page HTML for the Results table `data-slot="table"`, a mock header label and a cell value; grep the served stylesheet for `--background`, `--foreground`, `--card`, `--muted`, `--border` oklch values; stop the server and delete temporary files
- [ ] 5.4 `openspec validate results-table-decomposition --strict`
