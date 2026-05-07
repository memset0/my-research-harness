## Why

In the exp card grid (`/p/<project>`), each card has two header
elements: the monospace `E-id` link and a plain `<h3>` title. Today
only the E-id is clickable — the title (which is the more visually
prominent element and the natural hit target) does nothing.

The user wants the title to navigate to the exp detail page too,
so a click anywhere on the card header lands the user where they
expect.

## What Changes

- In `experiment-card-grid.tsx`, the card title `<h3>` SHALL be
  rendered inside a `<Link>` that navigates to
  `/p/<project>/e/<exp-id>` — the same URL the existing E-id link
  uses.
- The title SHALL gain `hover:underline` so the affordance matches
  the existing E-id link's hover treatment.
- The E-id link stays as-is (unchanged).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `web-dashboard`: extend the card-shape requirement (or add a small
  one) pinning the click-target rule.

## Impact

- `apps/web/components/experiment-card-grid.tsx` — wrap the title
  `<h3>` in a `<Link>`. No structural rearrangement.
- No backend, no API, no data shape change.
