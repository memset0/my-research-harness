## Context

The project list page is rendered by
`apps/web/components/experiment-card-grid.tsx`. Its top-level layout is
a flex column with three children inside a `flex-col gap-4 p-4 md:p-6`
wrapper:

```tsx
<div className="flex flex-col gap-4 p-4 md:p-6">
  <AnomalyBanner project={project} />
  <h2>Experiments ({sortedExps.length})</h2>
  <div>{sortedExps.map(…)}</div>
  …
</div>
```

The anomaly banner itself (`anomaly-banner.tsx`) renders the per-anomaly
list in a scrollable `<ul>` with `max-h-[40vh] space-y-1 overflow-y-auto
text-xs`.

## Goals / Non-Goals

**Goals:**
- Heading on top, banner below, grid below that.
- Banner takes half the vertical real estate it does today.

**Non-Goals:**
- No change to the heading text, level, or styling.
- No change to the banner's color, border, body content, or
  per-anomaly line format.
- No change to the gap rhythm of the wrapping flex column (`gap-4`
  stays — that's already the right rhythm and bug 2 just made the
  banner's internal rhythm match).

## Decisions

**D1. Swap nodes in JSX, not via CSS ordering.** The two children are
flat siblings in a flex column. Swapping their JSX order is the
clearest expression of the new ordering — using `order-*` Tailwind
utilities would obscure intent and break for screen readers (they
announce DOM order).

**D2. `max-h-[20vh]` is exactly half of `max-h-[40vh]`.** The user
explicitly asked for "缩小到现在的一半". `[20vh]` is the literal halving.

## Risks / Trade-offs

- [Risk] On viewports where 20vh < the height of one anomaly row, the
  scroll could become awkward. → Mitigation: `text-xs` rows are ~16px
  tall; 20vh ≥ ~150px on any sane viewport, so 8+ rows always fit.

## Migration Plan

Code-only edit, no data changes. Rebuild + restart picks it up.

## Open Questions

None.
