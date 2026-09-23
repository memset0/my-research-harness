## 1. Schema and validation

- [x] 1.1 In `apps/web/lib/components/datatable/v1/index.ts`, add `scatter` to the plot `type` enum and add optional `filters` / `filter_mode` (with the strict matcher schema) to the table branch; verify with `index.test.ts` cases that old payloads (table/line/bar only) still parse to identical data and that a scatter view and a filtered table view parse
- [x] 1.2 Extend `refine` with unknown `where` column, duplicate label, and multiple-defaults-in-`one`-mode checks, reporting the paths from design decision 4; verify with new `index.test.ts` invalid cases asserting each path, plus `filters` on a line view being rejected
- [x] 1.3 Update the `views` description, `description`, `useWhen`, `example`/`invalidExamples` to document scatter and filters (add one invalid example for an unknown filter column); verify the descriptor self-test in `index.test.ts` passes

## 2. Pure models

- [x] 2.1 Add `matchesFilter` / `filterRows` to `series.ts` implementing scalar, list, and operator matchers with `cellLabel` text equality and `cellNumber` comparisons; verify with a new `series.test.ts` covering each operator, non-number cells failing numeric comparisons, AND across `where` entries, and AND across active filters
- [x] 2.2 Add `buildScatterModel` to `series.ts` (one point per kept row, series in first-appearance order, tabs/select filtering, skipped count for non-numeric x or y, raw labels kept); verify in `series.test.ts` that duplicate-x rows both survive and an `n/a` x is counted as skipped

## 3. Rendering

- [x] 3.1 In `render.tsx`, render filter chips above the table (`any` toggles, `one` radio with leading `All`), initialise from defaults, show `N of M rows` and a no-match message; verify in `render.test.tsx` the default-applied, switch/clear, combine, and no-match scenarios
- [x] 3.2 In `render.tsx` / `plot.tsx`, route `scatter` views to `buildScatterModel` and a recharts `ScatterChart` (numeric axes, zero anchors, legend for >1 series, raw-text tooltip) while keeping recharts only in `plot.tsx`; verify with a `render.test.tsx` case that the scatter view mounts with `data-datatable-plot="scatter"` and reports skipped rows
- [x] 3.3 Confirm existing `render.test.tsx` and `index.test.ts` cases pass unchanged (no filter chips on unfiltered tables)

## 4. Generated docs and verification

- [x] 4.1 Run `node scripts/component-docs.mjs --write`, then `--check`; verify the `memon-components` skill table lists the new fields and the check exits 0
- [x] 4.2 Run `pnpm --filter @memon/web typecheck` and the datatable test files; verify both pass
- [x] 4.3 Build the web app separately from any live build output and, against a served page containing a scatter view and a filtered table, confirm the markup contains `data-datatable-filters` / `data-datatable-plot="scatter"` and the compiled CSS defines the theme tokens used (F1/F4 checks), and inspect it in a browser if one is available
