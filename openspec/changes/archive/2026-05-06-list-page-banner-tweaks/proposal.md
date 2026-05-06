## Why

Two small UX issues on the v3 project list page (the Experiments tab):

1. **Heading order is wrong.** The `<h2>Experiments (N)</h2>` page
   heading currently renders BELOW the anomaly banner, so when a
   project has anomalies the page reads "warnings → heading → grid"
   instead of "heading → warnings → grid". The user wants the page
   structure to read like a typical document: section title first,
   then warnings, then content.
2. **Banner scroll area is too tall.** The anomaly banner's scrollable
   `<ul>` uses `max-h-[40vh]` — almost half the viewport. On a project
   with many anomalies (e.g. `sparse-fsdp` has 71) the banner pushes
   the grid below the fold. The user wants the scroll area halved to
   `max-h-[20vh]`.

Both are pure layout edits. No backend, no data changes.

## What Changes

- The project list page (`ExperimentCardGrid`) SHALL render the
  `Experiments (N)` heading FIRST, with the anomaly banner directly
  below it (and the experiment grid below the banner).
- The anomaly banner's scrollable list SHALL use `max-h-[20vh]`
  (halved from the previous `max-h-[40vh]`).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `web-dashboard`: clarify the list-page section ordering (heading
  first, banner second, grid third); update the banner's scroll-area
  `max-h` to `[20vh]`.
- `experiment-membership-anomalies`: update the banner's scroll-area
  `max-h` reference to `[20vh]`.

## Impact

- `apps/web/components/experiment-card-grid.tsx` — swap the order of
  `<h2>` and `<AnomalyBanner />` inside the page wrapper.
- `apps/web/components/anomaly-banner.tsx` — change `max-h-[40vh]` to
  `max-h-[20vh]` on the scrollable `<ul>`.
