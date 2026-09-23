## Context

`datatable@1` lives in `apps/web/lib/components/datatable/v1/`: `index.ts` (zod schema, cross-field `refine`, descriptor text), `series.ts` (pure plot model), `render.tsx` (view switcher, table, tabs/select controls), and `plot.tsx` (the only recharts importer, lazily loaded). `views` is a `discriminatedUnion('type', [tableView, plotView])` with both branches `.strict()`, so today any extra key is a validation error. The generator `scripts/component-docs.mjs` renders the descriptor's zod `describe()` text into the `memon-components` skill table.

The existing `buildPlotModel` merges rows into one point per distinct `x` label (one value per series at that x). That is right for line/bar and wrong for scatter, where two rows with the same `x` in the same series are two dots.

## Goals / Non-Goals

**Goals:**
- Stay inside `datatable@1`: only add optional fields and one new discriminant value; old payloads parse to the same data.
- Keep the chart bundle lazy: filter chips and the row predicate must not import recharts.
- Keep filtering pure and unit-testable apart from React.

**Non-Goals:**
- Reader-authored ad-hoc filters (free text search, per-column header filters, sorting).
- Filters on plot views (plots already have `tabs`/`select`); OR-combination across filters in `any` mode; regex or date matchers.
- Persisting filter state in the URL or across page loads.

## Decisions

1. **Scatter as a third value of the plot `type` enum**, not a separate schema branch. It needs exactly the plot roles and axis flags, so it reuses `plotView`, `PLOT_ROLES` validation, and the tabs/select controls in `render.tsx` unchanged. Alternative (own branch with e.g. `size`/`label` roles) was rejected as scope creep; those can be added later as optional fields.

2. **Separate scatter model.** Add `buildScatterModel(columns, rows, view, filter)` in `series.ts` returning `{ series: string[], points: { series, x, y, xLabel, yLabel }[], skipped }` — one point per kept row, rows with non-numeric `x` or `y` counted as skipped. `plot.tsx` renders it with recharts `ScatterChart` (one `<Scatter>` per series, numeric `XAxis`/`YAxis` with the same domain rules). The tooltip reads raw `xLabel`/`yLabel` from the point, preserving the raw-text rule. Both axes get a few pixels of padding so dots on the extreme values are not clipped by the plot edge, and the legend passes `itemSorter={null}` so it keeps series first-appearance order instead of recharts' default name sort. `render.tsx` picks the model by `view.type`. Reusing `buildPlotModel` would silently drop duplicate-x rows.

3. **Filter schema on the table branch.**
   ```yaml
   - type: table
     filter_mode: one        # or any (default)
     filters:
       - label: fid < 15
         where: { fid: { lt: 15 } }
         default: true
       - label: bf16 only
         where: { run: bf16 }
       - label: two runs
         where: { run: [bf16, baseline], step: { gte: 10000 } }
   ```
   Matcher = `scalar | scalar[] | { eq?, ne?, in?, not_in?, lt?, lte?, gt?, gte? }` (operator object `.strict()`, non-empty). Text comparisons use the existing `cellLabel` so `10000` and `"10000"` compare equal, matching how tabs/select already compare cells; numeric comparisons use `cellNumber`, and a non-number cell fails them. Declared filters rather than reader-built ones were chosen because the user asked for named, author-curated filters shown as chips, and it keeps the payload the single source of what a reader can see.

4. **Cross-field checks in the existing `refine`**: unknown `where` column (path `views[i].filters[j].where.<col>`), duplicate label (`views[i].filters[j].label`), more than one default in `one` mode (`views[i].filters`). Unknown keys on plot views stay rejected by `.strict()`, so `filters` on a plot view is invalid for free.

5. **Row predicate in `series.ts`** (`matchesFilter(columns, row, where)` plus `filterRows`), pure and shared by tests. `render.tsx` holds `Set<label>` state per table view, initialised from defaults; the active view index already remounts per view so state resets when the reader switches views and back — acceptable, and matches tabs/select behaviour.

6. **Chip UI** uses the same toggle-button styling already used by the view switcher (`data-active`, muted background), with `aria-pressed`; `one` mode prepends an `All` chip. Counts line: `N of M rows`. Data attributes (`data-datatable-filters`, `data-datatable-filter=<label>`, `data-datatable-rowcount`) make render tests and curl checks straightforward. No new shadcn component is needed; `toggle-group` was considered but is not installed, and installing it only for this is unnecessary.

## Risks / Trade-offs

- [Pages using the new fields show verbatim on a central instance that lacks this change] → central is updated by the normal release right after this change; document in the descriptor that the fields need a current central.
- [Numeric-looking strings compare as text for `eq`/scalar matchers, e.g. `1e3` vs `1000`] → documented; authors use `lt`/`gt` or write the cell text they declared.
- [Scatter with thousands of rows renders slowly in SVG] → same order of magnitude as existing line views; no mitigation now.
- The spec requirement's heading still says "table, line, and bar views"; it is kept verbatim so the delta is a plain MODIFIED rather than a rename.

## Migration Plan

None on disk. Additive schema; regenerate component docs; release as a MINOR bump because the `memon-components` skill text changes; deploy central. Rollback = revert the commit; blocks using new fields then show verbatim with a diagnostic, nothing is lost.
