## Why

The experiment list (`apps/web/components/experiment-list.tsx`) renders
each row as a 6-column grid: `id | status | created | updated | tags |
hypotheses`. Tags and hypotheses live in fixed-width columns
(`md:col-span-1` and `md:col-span-2` respectively). When a project
accumulates real-world tags and many hypothesis refs (sparse-fsdp has
runs declaring `[H0001..H0010, H0018, H0019]` and tags like
`[failed, oom, comm-dump, fragmentation, deepseek-1.5b, forensics]`),
those columns wrap onto multiple lines, the row's height balloons,
and the rest of the columns waste a lot of horizontal space.

The user wants:

1. **Status as the leftmost column** (currently 2nd). Status is the
   primary at-a-glance signal for "is this run worth opening?" — emoji
   pill should be the first thing the eye lands on.
2. **Tags + hypotheses move OFF their own columns** and become a
   secondary line *below* the experiment id, inside the same row card.
   This drops two column-width constraints; the chips can now fill the
   row's full width before wrapping. Order: hypotheses first, tags
   after.

The remaining columns (id, created, updated) stay in a row stripe at
the top of the card. The card height becomes deterministic: one stripe
plus optional one (or two on extreme cases) wrap-line of chips below.

## What Changes

- Reorder the top row stripe to `[ status | id | created | updated ]`.
  Status leftmost, then id (mono, primary text), then the two
  timestamps as today.
- Drop the `tags` and `hypotheses` columns from the desktop grid
  header AND from each row's grid.
- Below the top stripe (still inside the same row's card), render a
  second flex-wrap line containing:
  - First: the hypothesis badges (clickable, pointing at the
    hypotheses page anchor — same target as today's chip).
  - After hypotheses: the tag badges (`variant="outline"` as today).
  - Last: the `no README` warning badge (when `!exp.hasReadme`).
- This second line SHALL be hidden when both hypotheses AND tags
  AND the warning are empty — the row collapses to just the top stripe.
- The desktop column header above the list SHALL be updated to match
  the new top stripe (`status | id | created | updated`); the previous
  `tags | hypotheses` headers are removed.
- Mobile (single-column) layout already stacks vertically and is
  largely fine; the change there is purely the order swap (status
  before id) and the same hypotheses-first-tags-after below.
- The semantic content (id, status, mtime, tags, hypotheses) is
  unchanged — only the visual arrangement is reordered.

## Capabilities

### Modified Capabilities

- `web-dashboard`: the "Experiment list view" requirement names the
  columns `Status / ID / Name / Created / Hypotheses / Tags`. Update
  to reflect the new layout: top stripe is `Status / ID / Created /
  Updated`, with hypotheses + tags rendered below the id as wrap-flow
  chips.

### New Capabilities

(none)

## Impact

- **Code:** `apps/web/components/experiment-list.tsx` only — both the
  column-header `<div>` and the `ExperimentRow` body. Roughly 20 lines
  of JSX changed.
- **Specs:** `web-dashboard` modification.
- **Tests:** the existing snapshot/render tests for `ExperimentRow`
  (if present) will need their fixtures updated. If no snapshot tests
  exist for this component, add one covering: row with hypotheses +
  tags, row with neither (collapsed second line), row with warning.
- **Visual regression risk:** layout change is the entire point of
  this change. CLAUDE.md F1 mandates a manual look at the rendered
  HTML before declaring done.
- **Backward compat:** zero. Only visual arrangement changes; URLs,
  data shape, click targets all preserved.
- **Out of scope:**
  - Sortable column header clicks (today only `created_at desc` sort
    is hardcoded).
  - Hiding the second line under a "show more" toggle when many chips
    are present. Trust wrap-flow and accept slightly taller rows for
    chip-heavy experiments.
  - Color-coding tags by category. Sticking with `outline` variant
    today; can be revisited.
