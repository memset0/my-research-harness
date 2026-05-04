## Context

`apps/web/components/experiment-list.tsx:103-140` defines `ExperimentRow`
as a single grid row with six columns. The column widths
(`md:col-span-{3,2,2,2,1,2}`) sum to 12. Tags and hypotheses get 1 + 2
columns respectively, both with `flex flex-wrap gap-1` to stack chips
vertically when they overflow.

The visible failure mode: a run with many tags or hypothesis refs
forces those two columns to grow vertically, but the timestamps and
status next to them stay rendered against the top of the row card —
result is a tall row with mostly-empty columns 1–4 and chip-stuffed
columns 5–6. Looks lopsided and wastes horizontal space.

The fix is structural: stop treating tags/hypotheses as columns. The
top stripe is for the structured one-liner (status → id → timestamps);
chips live in their own line below where they have full row width to
wrap into.

## Goals / Non-Goals

**Goals:**

- Each row's top stripe is a fixed, predictable shape: status pill,
  id (mono), created, updated.
- Chips (hypotheses + tags + warning) flow as a wrap line below the
  top stripe, sharing one row of horizontal real estate.
- Status emoji is the leftmost cell — first glance gives the
  primary "should I open this?" signal.
- Hypotheses render before tags within the chip line.
- The chip line is omitted entirely when there are no chips; rows for
  bare experiments (no tags, no hypotheses, has README) stay one-line tall.

**Non-Goals:**

- Restructuring the data passed to the row.
- Adding sort/filter UI.
- Changing the row's clickability (still navigates to the experiment
  detail page).
- Tweaking the mobile single-column layout beyond the same status-first
  reorder + chip order swap.

## Decisions

### D1. Top stripe is a 4-cell grid; chip line is a flex-wrap below

Top stripe column allocation (assuming the existing 12-col grid):
- `status` — `md:col-span-2` (room for the colored pill + stale icon)
- `id` — `md:col-span-5` (mono text, the primary row identifier — wider than today's 3 because we reclaimed space from tags/hypotheses)
- `created` — `md:col-span-2`
- `updated` — `md:col-span-3`

Chip line below the top stripe is a single `<div>` with
`flex flex-wrap gap-1 mt-1`; renders only when at least one chip
exists.

Alternative considered: keep the 12-col grid for the top stripe AND
put chips in a sibling row of the SAME grid via `col-span-12`. Same
visual outcome but the top stripe layout becomes coupled to the chip
line's existence. Rejected — separating into two stacked elements is
cleaner.

### D2. Chip order: hypotheses first, then tags, then warning last

Per the user's request: 假说 in front, tags after. Warning ("no README")
is a fault state and should be visually distinct — it stays at the
right edge of the chip line. The reading order chip-line-left-to-right
is: hypotheses → tags → warning.

Implementation:
```tsx
{(fm.hypotheses.length > 0 || fm.tags.length > 0 || noReadme) && (
  <div className="flex flex-wrap items-center gap-1">
    {fm.hypotheses.map(h => <Badge key={h}>{h}</Badge>)}
    {fm.tags.map(t => <Badge key={t} variant="outline">{t}</Badge>)}
    {noReadme && <WarningBadge>no README</WarningBadge>}
  </div>
)}
```

The conditional gate prevents the empty `<div>` from contributing
margin/spacing to clean rows.

### D3. Sub-project badge from `project-membership-from-config` integrates here

The recently-landed sub-project badge (rendered next to the id when
`fm.project !== exp.project`) belongs on the top stripe inside the id
cell, NOT on the chip line. The id and its sub-project label travel
together — moving the badge below the id would break that pairing.

So the id cell becomes a small flex container:
`<span class="font-mono">{exp.id}</span>` followed by the optional
sub-project badge.

### D4. Column header row mirrors the new top stripe

The list has a `<div>` above the row stack rendering the column
header labels (`id, status, created, updated, tags, hypotheses`).
Update to `status, id, created, updated`. Drop the `tags` and
`hypotheses` headers — chips are self-labeling.

### D5. Mobile (`<md`) layout

Today's mobile rendering uses `grid-cols-1` so all six cells stack
vertically. Under the new layout we keep `grid-cols-1` for the top
stripe (status, id, created, updated stack vertically as before but
with status moving to the top), and the chip line stays a wrap-flow
flex below. No new mobile-specific work; the responsive breakpoint
toggles remain untouched.

## Risks / Trade-offs

- **Visual regression on project-a/b mock data**: those experiments
  have small chip counts so the new layout looks subtly different.
  → Mitigation: manual look at the rendered page (per CLAUDE.md F1
  protocol) before declaring done.

- **Snapshot test churn**: any existing snapshot of `ExperimentRow`
  needs to be regenerated. → Mitigation: spot-check the new snapshot
  before committing to ensure it captures the intended layout.

- **CSS surface tweaks**: the chip line's `mt-1` adds vertical rhythm
  that didn't exist before. With many chips wrapping, the row gets
  taller. The user explicitly accepts this — it's the chosen tradeoff
  vs the current "fixed-narrow column squeezes everything sideways."

- **Backward compat**: none broken. Click target, URL, data flow
  unchanged.

## Migration Plan

1. Edit `experiment-list.tsx`: column header + `ExperimentRow`. One
   commit.
2. Update `web-dashboard` spec delta.
3. Manual smoke per CLAUDE.md F1 verification:
   - Open `/p/project-a` (small chips, expect no second-line crowding)
   - Open `/p/sparse-fsdp/recipe X` if visible (large chip counts;
     observe wrap)
4. Snapshot test update if any.

Rollback: single revert. No data on disk to undo.

## Open Questions

1. Should the chip line truncate after N chips with a "+M more"
   indicator? The user didn't ask for it; defer until we see real
   pain (sparse-fsdp's hypothesis-heavy runs are the worst case and
   they currently look bad in different ways — going from "narrow
   column wraps" to "full-width wraps" is already a big win).

2. Should `created` and `updated` collapse into a single relative
   "5m ago" cell with hover for absolute? Out of scope, but a strong
   candidate for a follow-up — the four-cell stripe still has some
   air left and a single relative cell would tighten it.
