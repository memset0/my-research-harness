## Context

Current `RunBody` (post bug-3 + the propose+apply cycles since):

```tsx
<div className="flex flex-col gap-3 border-t p-3">  // outer wrapper
  <RunFrontmatterCard run project />                 // nested card with border + bg
  <ActionBar>...buttons...</ActionBar>               // flex-wrap row of buttons
  <RunSection heading="Setup" />
  <RunSection heading="Result" />
  {run.hasReadme && <WarningsCard … />}              // duplicate of exp-level Warnings
  <RunArtifactsBlock />
  {run.hasReadme && <LogViewer expPath={run.path} />}
  <FileTreeSection />
</div>
```

`RunFrontmatterCard` itself starts with:

```tsx
<div className="rounded-md border bg-card/40 p-2">
  <div className="mb-2 flex flex-wrap items-center gap-2">
    <span className="font-mono text-xs">{run.id}</span>
    {run.hasReadme ? <StatusEdit … /> : <Badge>no README</Badge>}
    {run.parseErrors.length > 0 && <Badge variant="destructive">…</Badge>}
  </div>
  <dl …>{/* fields */}</dl>
</div>
```

The trigger row directly above the CollapsibleContent ALREADY
renders `<StatusPill> <span>{runId}</span> <span>…createdAt host</span>`.
So the inner row inside the frontmatter card IS purely redundant
text content (status + id), differing only in StatusPill (read-only)
vs StatusEdit (editable).

## Goals / Non-Goals

**Goals:**
- Three flat stripes inside the panel: action bar → frontmatter →
  body.
- Dividers between stripes are `border-t` on the stripe `<div>`,
  spanning the full panel width.
- StatusEdit moves to the action-bar stripe so the panel still has
  a place to change run status without the frontmatter id row.
- The `<WarningsCard>` and its `import` are removed from this file.

**Non-Goals:**
- Don't change which fields the frontmatter shows.
- Don't change Setup / Result / Artifacts / LogViewer / FileTree
  rendering (they stay as today inside the body stripe).
- Don't drop the per-run Artifacts block. It's a different surface
  from the exp-doc-level aggregated Artifacts card and remains
  useful inline.
- Don't touch the legacy `experiment-detail.tsx` page; it keeps
  the WarningsCard until that page is deleted in a separate change.

## Decisions

**D1. Three stripes, each `border-t p-3`.** With no outer wrapper
padding, `border-t` on the first stripe sits directly under the
trigger row (the existing `border-t` was on the outer wrapper —
moving it to the first stripe is a no-op visually, just relocates
where the class lives). Subsequent stripes get their own
`border-t`. All stripe borders span 100% of the content-box width,
which is the panel's inner edge.

**D2. StatusEdit moves to the action bar.** The natural reading
order (action → metadata) means status editing is an action; it
shouldn't be tucked into the frontmatter description. The action
bar already contains other run-level actions (Edit, Open Claude
Code, Terminal, Note); StatusEdit is the same family.

**D3. Drop the redundant id+status row.** With StatusEdit moved
out and the trigger row above already showing id + StatusPill,
the inner header row is all duplication. Removing it means the
frontmatter stripe is just the dl grid.

**D4. `parseErrors` badge moves to the action bar too.** It's a
small parse-error indicator that visually pairs with status
controls. Move it next to StatusEdit so it stays visible without
needing a header row inside the frontmatter stripe. (Keep it as
a Badge; it's not interactive.)

**D5. Keep `RunFrontmatterCard` as a function name** but rename
its returned wrapper to a stripe (no nested card chrome). The
function rename is cosmetic; the user-facing change is the
output. Internally I'll call the function `RunFrontmatterStripe`
to reflect its new shape.

## Risks / Trade-offs

- [Risk] Some users relied on the per-run WarningsCard to add
  warnings on a run-by-run basis. → Mitigation: the v3 model
  treats warnings as exp-doc-level. The exp page's
  `## Warnings` section is the canonical place; users can still
  attribute a warning to a specific run via the existing `Run`
  column in the warnings table at the exp level.
- [Risk] Action-bar density grows by adding StatusEdit and the
  parse-errors badge. → Mitigation: the action bar already uses
  `flex flex-wrap gap-2` so adding two more items wraps cleanly
  on narrow viewports.

## Migration Plan

Code-only edit. Restart picks it up.

## Open Questions

None.
