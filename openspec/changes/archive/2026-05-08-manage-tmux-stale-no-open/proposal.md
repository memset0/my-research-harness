## Why

The original `tmux-session-rework` design specified "Stale classification
SHALL NOT prevent the kill / open actions from working" — every row
got `[Drawer] [Popup] [Kill]` regardless of matchability.

In actual use, opening a stale session in the drawer / popup is
counterproductive:
- The route hands the request to manager.ts, which falls back to the
  project root or `$HOME` (per the `target not found` warning path).
- The drawer iframe loads against an unmatched project; the user sees
  a "project not in config" warning and a tmux session whose context
  is ambiguous.
- For a stale row, the user almost always wants to **clean it up**,
  not look at it. Killing is the useful action.

This change removes Drawer / Popup affordances from stale rows. Kill
stays as the only action. The Target cell still shows the inline
`⚠ stale (...)` indicator (no UI regression there).

## What Changes

- The `/manage/tmux` row actions for **stale rows** SHALL render only
  `Kill`. `Drawer` and `Popup` buttons SHALL be omitted (not just
  visually hidden — fully absent from the row).
- For matchable rows, behavior is unchanged: `[Drawer] [Popup] [Kill]`
  with `Popup` Tailwind-hidden below `md` (mobile).
- The `tmux-session-management` spec's stale-classification line
  ("Stale classification SHALL NOT prevent the kill / open actions
  from working") is amended: stale only blocks `Kill` from being
  prevented. Open is intentionally blocked for stale.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `tmux-session-management`: change the row-actions and stale
  classification language so stale rows expose only `Kill`.

## Impact

- `apps/web/app/manage/tmux/tmux-page.client.tsx` — conditionally
  render the Drawer / Popup buttons only when the row is matchable.
  Tighten the existing `disabled={!p.agent || !p.project || !p.scope || !p.slug}`
  check to also gate on `row.matchable`.
