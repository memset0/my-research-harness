## 1. Edit experiment-list.tsx

- [x] 1.1 Update the column header `<div>` (currently `id, status, created, updated, tags, hypotheses`) to the new four-cell layout: `status, id, created, updated`. Drop the tags and hypotheses headers.
- [x] 1.2 In `ExperimentRow`, restructure the grid: top-stripe span allocations status `col-span-2`, id `col-span-5`, created `col-span-2`, updated `col-span-3`. Sub-project badge stays inline next to the id.
- [x] 1.3 Move the hypotheses + tags + `no README` warning rendering OUT of the grid into a sibling `<div className="flex flex-wrap items-center gap-1 mt-1">` below the grid, inside the same `<Link>` card. Order inside: hypotheses (clickable badges), tags (`variant="outline"`), warning. Conditionally render the entire `<div>` only when at least one of {hypotheses, tags, no-README} is present.
- [x] 1.4 Verify mobile (`<md`) layout still stacks the top stripe vertically (existing `grid-cols-1` rule). The chip line stays a wrap-flow flex on every breakpoint.

## 2. Tests

- [x] 2.1 If a render test exists for `ExperimentRow` / `experiment-list`, update its fixture; otherwise add one covering: bare row (no chips), row with hypotheses + tags, row with `hasReadme: false`, row with sub-project badge. Assert the chip-line div is absent on the bare-row case.
- [x] 2.2 Web typecheck + test pass.

## 3. Manual smoke (per CLAUDE.md F1)

- [x] 3.1 Restart dev server; open `/p/project-a` in a browser. Confirm: status pill leftmost; id next with optional sub-project badge; chip line below id when chips exist; row collapses to one stripe when no chips.
- [x] 3.2 Open `/p/sparse-fsdp` (chip-heavy real data). Confirm chip line wraps at full row width without squeezing the top-stripe timestamps.
- [x] 3.3 Curl the page and grep the served HTML for the new layout markers (the chip-line `<div>` adjacent to the id, no `tags`/`hypotheses` column-header text).

## 4. Verification + commit

- [x] 4.1 `pnpm --filter @memon/web typecheck` clean.
- [x] 4.2 `pnpm --filter @memon/web test` clean.
- [x] 4.3 `openspec validate compact-experiment-row --type change` clean.
- [x] 4.4 Commit. Body: before/after screenshot description (status moves left; tags+hypotheses move below id).
