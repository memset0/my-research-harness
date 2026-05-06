## Why

The AppBar's `Experiments` tab is wrong on two counts after the v3 upgrade:

1. The little count badge next to the label shows the number of **runs** in
   the project (because the underlying query still calls `/api/runs`),
   while in v3 the tab semantically means "experiment docs". A project
   with 12 exp docs and 47 runs renders `47` in the badge.
2. The tab does not pick up its `active` highlight when the user is on
   `/p/<project>/e/<exp-id>` (or its query-string variant `?run=…`),
   because the matcher only fires on `${projectBase}` and
   `${projectBase}/experiments/...`. Exp detail pages live under `/e/`,
   not `/experiments/`.

Both are spec-level behaviors (badge meaning, active-highlight URL
coverage) that should be pinned down so they don't silently regress in
future passes.

## What Changes

- The `Experiments` AppBar tab's count badge SHALL display the number of
  exp docs in the current project (using the v3
  `['experiments', project]` query key), NOT the number of runs.
- The `Experiments` AppBar tab SHALL render in the active state on every
  experiment-related URL: the project root (`/p/<project>`), v3 exp
  detail pages (`/p/<project>/e/<id>` with or without `?run=…`), and the
  legacy v2 detail route (`/p/<project>/experiments/<id>`). The legacy
  run URL `/p/<project>/r/<id>` already redirects to `/e/<id>` server-
  side, but for the brief moment the matcher sees `/r/`, the tab SHALL
  also treat that as active so the highlight does not flicker off
  during the redirect.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `web-layout`: tighten the AppBar tab requirements so the
  `Experiments` tab's count and active-highlight scope match v3 routing
  + v3 data semantics.

## Impact

- `apps/web/components/tab-badge.tsx` — `useExperimentsCount` switches
  data source from `fetchExperiments` (which is `/api/runs`) to
  `fetchExperimentDocs` (`/api/experiments`), and its query key changes
  from `['runs', project]` to `['experiments', project]`.
- `apps/web/components/app-bar.tsx` — the `Experiments` tab's `matches`
  function broadens to cover `/e/`, `/r/`, and `/experiments/` paths
  under the project base, plus the bare project root.
- No backend changes. No SSE wire changes. No TanStack key drift
  (`['experiments', project]` is already the canonical v3 key per
  `CLAUDE.md`).
