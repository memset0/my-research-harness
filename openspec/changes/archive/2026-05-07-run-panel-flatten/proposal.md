## Why

The expanded run panel currently wraps its frontmatter in a nested
`<div class="rounded-md border bg-card/40 p-2">` — a card-inside-a-
card look that the user finds visually awkward. It also has these
problems:

1. **Redundant id row.** The frontmatter card's first row repeats
   `<run.id>` + StatusEdit, but the trigger row directly above
   already shows the status pill and the id. Showing them twice in
   adjacent rows is noise.
2. **Action bar position.** Action buttons sit BELOW the
   frontmatter, but in a top-down read the most immediately useful
   actions (edit, open terminal, etc.) should sit above descriptive
   metadata.
3. **No section dividers.** The frontmatter, action bar, and section
   bodies are all separated only by `gap-3` flexbox spacing, with no
   visual divider to anchor each section.
4. **WarningsCard duplication.** The exp doc already owns the
   Warnings table at the exp level; surfacing a per-run WarningsCard
   inside every run panel is duplicative — warnings live ON the
   experiment, not on individual runs in v3.

The user wants the panel restructured to read cleanly:
**action bar → divider → frontmatter → divider → body sections**.
The dividers should run **edge-to-edge** of the run-panel box (no
horizontal margin between the divider's ends and the panel border).

## What Changes

- **BREAKING (UI-only)**: the per-run `<WarningsCard>` SHALL be
  removed from the expanded run panel. Warnings management for an
  experiment lives on the exp doc's `## Warnings` table only.
- The expanded run panel SHALL render its content as three
  divider-separated stripes inside the Collapsible content area, in
  this top-to-bottom order:
  1. **Action bar stripe** — `Edit markdown`, `Open Claude Code`,
     `Terminal`, `+ Note` plus the `StatusEdit` control. Placed
     ABOVE the frontmatter.
  2. **Frontmatter stripe** — the existing dl grid (name, project,
     created, finished, host, pid, gpus, entry, command, wandb,
     tags, hypotheses). The redundant `{run.id}` + StatusEdit row
     at the top of the previous nested card SHALL be removed (the
     trigger row above already shows id + status, and StatusEdit is
     now in the action-bar stripe).
  3. **Body stripe** — Setup + Result + per-run Artifacts +
     LogViewer + Files-in-run-dir tree, as they currently exist.
- Each stripe SHALL be a block child of `CollapsibleContent` with
  `border-t` and `p-3`, so the borders span the full content-box
  width (which is the run-panel border). Specifically there is NO
  outer wrapper with `p-3` — that horizontal padding lives inside
  each stripe so the `border-t` lines connect to the run-panel
  border.
- The `RunFrontmatterCard` helper SHALL be renamed conceptually to
  `RunFrontmatterStripe` (a flat block), losing the
  `rounded-md border bg-card/40 p-2` shell.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `experiment-edit`: amend the run-panel layout requirement to
  reflect the new stripe structure and remove the
  `WarningsCard lives in the panel` clause/scenario.

## Impact

- `apps/web/components/experiment-page.tsx` — restructure `RunBody`
  into three stripe blocks; update `RunFrontmatterCard` (rename
  internally to a stripe; drop the id+status row + the wrapping
  card chrome); drop the `WarningsCard` import and JSX.
- No backend, no API, no data shape change.
- The legacy `experiment-detail.tsx` (the v2 page) keeps the
  WarningsCard — that page is a deletion candidate but stays
  for now.
