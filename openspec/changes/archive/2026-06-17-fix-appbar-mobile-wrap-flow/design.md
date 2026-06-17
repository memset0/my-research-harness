## Context

`apps/web/components/app-bar.tsx` renders the sticky top AppBar. Today its
structure is three layout siblings inside a non-wrapping `flex items-center`
header:

```
<header flex items-center gap-2>
  <SidebarTrigger/>                       ← left
  <nav flex flex-1 flex-wrap gap-1 min-w-0 role="tablist">
    Experiments Hypotheses Journal Reports Digests "Code review"
  </nav>                                  ← left tabs, wrap INSIDE this box
  <ManageSharesDialog/>                   ← right
  <OpenWithButton/>                       ← right
</header>
```

Because the tabs wrap *inside* the `flex-1` `<nav>` box and the two right
controls live *outside* it, on a narrow viewport the tabs stack into 2–3
rows and the right controls get pinned to the right of that whole block,
vertically centered — a lopsided result. The header itself never wraps
(`flex`, no `flex-wrap`), so the left/right split is rigid.

Existing constraints encoded in the file's comments (must be respected):
- **No `overflow-x-auto` on the nav** — combined with shadcn Button's
  `active:translate-y-px`, a clipped overflow context turns `overflow-y`
  implicit-auto and yields a stray 1px scrollbar.
- The previous `flex-1 + min-w-0` on `<nav>` existed to let the nav
  constrain to remaining width so its *internal* wrap could trigger.

## Goals / Non-Goals

**Goals:**
- Keep the `SidebarTrigger` (drawer button) as a fixed leading control on the
  left — it is explicitly NOT part of the wrap flow and never reflows.
- One shared horizontal wrap flow for the six tabs + the two right controls,
  inside an inner wrapper to the right of the trigger.
- Tabs fill first; right controls flow *after* them, not in a detached box.
- Per-line alignment: on each flex line (especially the final shared line),
  left-aligned items hug the left, right controls hug the right edge.
- Preserve the `<nav role="tablist">` accessibility grouping for the tabs.
- Desktop single-line layout stays visually identical to today.
- Fix the `Code review` → `Code Review` label.

**Non-Goals:**
- No change to which tabs exist, their order, hrefs, active-match logic, or
  badges.
- No change to the right controls' own behavior (share dialog, open-with).
- No change to page `<title>`/`<h1>` "Code review(s)" strings elsewhere.
- No new shadcn component installs; no theme-token changes (so F2/F4 in
  CLAUDE.md don't apply — we only use already-defined utilities).

## Decisions

### D0. Keep the `SidebarTrigger` out of the wrap flow

The `<header>` stays a non-wrapping `flex items-center gap-2` row with exactly
two children: the `SidebarTrigger` (fixed leading control) and an inner wrap
container holding everything else. The trigger therefore stays pinned at the
left and vertically centered, and never reflows with the tabs or right
controls. Keeping the header `items-center` (not `items-start`) also preserves
the existing desktop look: on a single row the content is vertically centered
within the `min-h-12` bar rather than hugging the top.

### D1. Single `flex-wrap` flow in an inner wrapper via `display: contents` on `<nav>`

The inner wrapper is `flex flex-1 flex-wrap items-center gap-1 min-w-0` — it
claims the row's remaining width after the trigger (`flex-1` + `min-w-0`) and
owns the wrapping. Inside it, give the `<nav>` `className="contents"`
(Tailwind → `display: contents`). `display: contents` removes the nav's own
box from layout so its child `<Button>`s participate directly in the inner
wrapper's flex-wrap flow, while the `<nav role="tablist">` element stays in
the DOM and accessibility tree (modern Chromium/Firefox/WebKit keep role
semantics for `display:contents` on generic/landmark elements).

`flex-1` + `min-w-0` on the inner wrapper is load-bearing: without `min-w-0`,
flex's default `min-width:auto` keeps the wrapper at intrinsic content width
and overflow escapes to the page instead of wrapping.

- **Why over flattening (drop `<nav>`, map tabs straight into header):**
  flattening loses the `role="tablist"` grouping wrapper. `display:contents`
  keeps semantics *and* gets the shared flow.
- **Why over a CSS spacer element (`<div class="flex-1"/>`):** a flex-1
  spacer forces an awkward wrap point and doesn't degrade as cleanly per
  line as `ml-auto`. `ml-auto` is the idiomatic shadcn/Tailwind pattern for
  "push the rest of this line right."

The `flex-1 / min-w-0` previously on `<nav>` is dropped — irrelevant under
`display:contents` (the box no longer participates) and no longer needed now
that the header (not the nav) owns wrapping.

### D2. Right-group alignment via `ml-auto`

Wrap the two right controls in a single `div` group:

```jsx
<div className="ml-auto flex items-center gap-1">
  <ManageSharesDialog … />
  <OpenWithButton … />
</div>
```

- `ml-auto` makes the group absorb free space to its left on whatever flex
  line it lands on → it right-aligns per line. Since the group always comes
  *after* all tabs in DOM order, it is always on the last (or a shared-last)
  line, so the user's "最后一行 left-left / right-right" requirement holds
  for every wrap outcome.
- Grouping the two controls in one non-splittable `div` keeps them together
  (they never split across lines) and makes `ml-auto` apply to the pair as a
  unit.
- **Why a wrapper div over `ml-auto` directly on `ManageSharesDialog`:** the
  two controls render their own root elements; a wrapper guarantees they
  stay adjacent and share one auto-margin boundary regardless of each
  component's internal markup.

### D3. Keep the no-`overflow-x-auto` invariant

We add **no** overflow utility anywhere. Wrapping (`flex-wrap`) is the
overflow strategy, so the documented stray-scrollbar hazard never arises.
The existing explanatory comment is updated to reflect the new structure but
keeps the "do not add overflow-x-auto" warning.

### D4. Gap sizing

Header uses `gap-1` (matching the tabs' former internal gap) so wrapped rows
have consistent vertical+horizontal spacing. The slightly larger `gap-2`
previously separating the three top-level siblings is dropped in favor of
the uniform `gap-1`; `ml-auto` provides the visual separation between the
left cluster and the right group on shared lines.

## Risks / Trade-offs

- **[`display:contents` a11y regressions on very old browsers]** → The repo
  targets modern evergreen browsers (Next 15 / Tailwind v4). Generic/landmark
  `display:contents` role-preservation has been stable for years; the
  `role="tablist"`/`role="tab"` relationship is expressed on the elements
  themselves, which remain laid out. Acceptable.
- **[Desktop layout drift]** → On a wide viewport everything fits on one
  line and `ml-auto` reproduces the current "tabs left / controls right"
  look. Verified by the F1 markup check (grep served HTML) + visual check.
- **[Right group wrapping to its own line leaves a tall-ish bar on mobile]** →
  This is the intended, correct behavior (clean stacked rows beat a lopsided
  pinned block). The bar already grows when tabs wrap; nothing regresses.

## Migration Plan

Pure front-end markup change in one component; no data migration, no flag.
Rollback = revert the single-file diff. Ship behind the standard prod
rebuild + restart for the dashboard.
