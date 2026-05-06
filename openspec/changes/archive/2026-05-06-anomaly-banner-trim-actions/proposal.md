## Why

The anomaly banner that appears at the top of the project (Experiments)
list page currently has two action buttons — `Copy all` and `Hide` — laid
out next to the title with bespoke header padding (`py-3` on
`CardHeader`, plus `pt-0` on `CardContent`). Two problems:

1. The `Hide` button hides the banner for the current `sessionStorage`
   lifetime. In practice that's noise: anomalies are blocking issues the
   user should resolve, and dismissing them per-session encourages
   "out of sight, out of mind". The user has confirmed they no longer
   want this affordance — `Copy all` (which feeds the anomaly text into
   a Claude Code session) is the only action that supports an actual
   workflow.
2. The custom `py-3` / `pt-0` rhythm makes the banner feel taller than a
   normal card, especially when only one or two anomalies are present.
   The user wants the spacing to match the rest of the cards on the
   page — i.e. the default shadcn Card/CardHeader rhythm.

## What Changes

- **BREAKING (UI-only)**: the `Hide` button SHALL be removed from the
  anomaly banner. There is no replacement; users who want to ignore an
  anomaly resolve it via the documented workflow (CLI / link / etc.).
  No persisted `sessionStorage` key needs to be cleaned up because the
  key was per-project and per-tab; it will simply be ignored if found.
- The `Copy all` button SHALL be the sole action and SHALL render in the
  banner header's top-right via shadcn's `CardAction` slot (so the
  layout is the standard 2-column header grid, not a manual flexbox
  override).
- The banner SHALL use the default shadcn Card/CardHeader rhythm — no
  custom `py-*` on the header and no `pt-0` on the content.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `experiment-membership-anomalies`: the "Web banner for anomalies"
  requirement loses the `Hide` button clause; the "Hide is per-session"
  scenario is removed.
- `web-dashboard`: the "Anomaly banner pinned at the top of the grid"
  requirement loses the `Hide` button clauses; the "Hide is per-session"
  scenario is removed; a new scenario pinning the top-right Copy-all
  position and default-rhythm spacing is added.

## Impact

- `apps/web/components/anomaly-banner.tsx` — drop `Hide` button, drop
  the `useEffect` + `useState` for the `hidden` flag, drop
  `HIDE_KEY_PREFIX` and the sessionStorage write/read, drop the
  `EyeOff` lucide import. Wrap the remaining `Copy all` button in
  `<CardAction>` so it lands in the header's right column. Remove the
  `flex-row items-center justify-between gap-2 space-y-0 py-3` overrides
  on `CardHeader` and the `pt-0` on `CardContent`.
- No backend changes. No SSE / wire / data-shape changes. No spec on
  hypotheses or runs is touched.
