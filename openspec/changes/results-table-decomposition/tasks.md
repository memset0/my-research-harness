## 1. Pure logic (D1)

- [x] 1.1 Create `apps/web/lib/experiment-results/{types,columns,format,filters,sorting,sota,layout}.ts` with the component's React-free helpers, exported
- [x] 1.2 Add table-driven unit tests for each module (empty table, missing column, mixed types, NaN, duplicate rows)
- [x] 1.3 Make `experiment-results-table.tsx` import the modules; existing 15 table tests pass

## 2. Merged validation (D2)

- [x] 2.1 Create `lib/experiment-results/views.ts` (types, scope helpers, shared predicates, strict guard, normalizer with invalid count); turn `lib/experiment-results-views.ts` into a re-export
- [x] 2.2 Unit-test every row of the design difference table, including "normalize output satisfies the strict guard"
- [x] 2.3 Use the normalizer in the table and render the invalid-settings note; table test for the note

## 3. Container and subcomponents (D3)

- [x] 3.1 Add `definition-edits.ts` and `transient-state.ts` with unit tests
- [x] 3.2 Extract cells, annotation tooltip, badge editors, column header, row, grid and pin-layout hook into `components/results-table/`
- [x] 3.3 Extract view switcher, column toolbar, column options and filter bar; container uses `useReducer` and stays ≤ 500 lines, every subcomponent ≤ 400 lines
- [x] 3.4 SOTA submenu sets the chosen mode directly; delete dead helpers
- [x] 3.5 Add subcomponent render tests asserting `data-slot` and key text

## 4. Query keys (D5)

- [x] 4.1 Invalidate the Inbox Report list with `queryKeys.reports(project)`; remove `reportsRawTarget` and its snapshot
- [x] 4.2 Test that saving a Report of a Host-qualified Project refetches the list

## 5. Verification

- [x] 5.1 `pnpm --filter @memon/web typecheck`, Biome on touched files, `pnpm --filter @memon/web test` (all files of this change pass; the only failures, 10 cases in `app/api/projects/[project]/git-diff/route.test.ts`, are outside this change and appeared after concurrent backend commits — the suite was fully green at the D2 commit)
- [x] 5.2 `pnpm --filter @memon/web build` in the checkout (not a live build output)
- [x] 5.3 F1: temporary mock copy (with an added Experiment carrying `results.yaml`) + temporary config on a free port, production start; the Experiment page body is client-rendered, so verify (a) the page's served JS chunk contains the new `data-slot`/`data-*` markers, (b) the Experiment API returns the Results document, (c) a server render of the built component from that API payload contains the Results table `data-slot="table"`, the mock header labels and cell values, and (d) the served stylesheets define `--background`, `--foreground`, `--card`, `--muted`, `--border` as oklch and contain the Tailwind classes the new components use; stop the server and delete temporary files (no headless browser could run on this host)
- [x] 5.4 `openspec validate results-table-decomposition --strict`
