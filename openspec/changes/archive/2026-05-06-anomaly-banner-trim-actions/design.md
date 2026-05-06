## Context

`apps/web/components/anomaly-banner.tsx` currently composes the banner as:

```tsx
<Card className="border-amber-400/70">
  <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 py-3">
    <CardTitle …>{count} issues need resolution</CardTitle>
    <div className="flex gap-2"><CopyButton /><HideButton /></div>
  </CardHeader>
  <CardContent className="pt-0">{list}</CardContent>
</Card>
```

The `flex-row` + manual `py-3` undoes the shadcn header's default
behavior. Because `Card` already wraps its children with `gap-4` and
`py-4`, layering `py-3` on top of `py-4` (above the header) and
`pt-0` (under the content) yields uneven, oversized vertical
spacing.

shadcn provides a built-in slot for header right-aligned actions:
`<CardAction>` (re-exported from `components/ui/card.tsx`). When a
descendant has `data-slot="card-action"`, `CardHeader` flips on
`grid-cols-[1fr_auto]` via `has-data-[slot=card-action]:`, putting the
title in column 1 and the action in column 2 — the canonical "title
left, action top-right" pattern with no manual padding required.

## Goals / Non-Goals

**Goals:**
- Single header action (`Copy all`) at top-right, via the shadcn slot.
- Default Card/CardHeader rhythm — no overrides on `py-*`, `gap-*`,
  `flex-row`, or `space-y-0`.
- Net code reduction (the Hide branch and its sessionStorage effect
  go away).

**Non-Goals:**
- Adding new banner actions. The user wants fewer, not more.
- Reworking the anomaly list body. It already scrolls correctly with
  `max-h-[40vh]` and one line per anomaly.
- Changing the banner's `border-amber-400/70` ring or any color.
- Removing the banner entirely on zero anomalies (already correct
  behavior).

## Decisions

**D1. Use `<CardAction>` instead of a sibling `<div>`.** This is the
shadcn-blessed slot. The CardHeader already conditionally lays out as
`grid-cols-[1fr_auto]` when this slot is present, so no manual flex
override is needed and the spacing rhythm matches every other Card on
the page.

**D2. Drop the `hidden` state machinery wholesale.** `useState`,
`useEffect`, `HIDE_KEY_PREFIX`, and the `sessionStorage` reads/writes
all become dead code with no `Hide` button. We don't need a sweep to
clean up old `sessionStorage` keys — they'll naturally evaporate after
the user's tab closes (sessionStorage is tab-scoped) and in any case
they cause no harm if they linger on disk.

**D3. Don't introduce `<Card size="sm">`.** That would also tighten
the rhythm but it's a different design (smaller all-around, not just
the header). The user said "normal card title spacing" — i.e. they
want this banner to look like every other card on the page, which is
the default size.

## Risks / Trade-offs

- [Risk] Removing `Hide` could surprise a user who relied on it. →
  Mitigation: the user explicitly requested the removal in this same
  session; no migration step required.
- [Risk] `sessionStorage` key `memon:anomaly-banner-hidden:<project>`
  is now orphaned. → Mitigation: tab-scoped storage clears on tab close;
  the constant + key are unused after this change so nothing reads from
  them; no cleanup pass needed.

## Migration Plan

Code-only edit. Rebuild + restart the prod web server picks it up.
Backout = `git revert` of the single commit.

## Open Questions

None.
