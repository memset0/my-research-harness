## Why

The per-project AppBar today shows only the labels `Experiments` /
`Hypotheses` / `Journal` (and post-`inbox-reports-and-digests`,
`Reports` / `Digests`). The labels carry zero information about what
you'll find when you click. After running a project for a couple of
weeks the user is constantly switching tabs to see "do I have any new
hypotheses?", "did journal grow?", and so on.

Inbox-style apps solve this with a count next to each label. Add it
here. With counts visible the user can scan the AppBar and immediately
see "23 experiments, 7 hypotheses, 142 journal events" without
clicking.

A separate concern — surfacing **warnings** ("this experiment has a
parse error", "this RUNNING experiment is stale") — was originally
bundled into the same request, but the user has decided to design a
proper warnings system later. This proposal explicitly **does not**
implement warning indicators; it leaves a hook (a CSS slot next to the
count) that the future warnings change can fill.

## What Changes

- **AppBar tabs SHALL show a numeric count badge** next to each label
  for the current project: experiments, hypotheses, journal events,
  reports, digests. Counts SHALL be live-reactive — when an SSE
  invalidation fires for a kind, the badge re-renders.
- The count SHALL be the same number that the underlying view shows
  by default (e.g. experiments count = the experiment-list's default
  filter result; journal count = total events; hypotheses count =
  parsed entries). For lists with default pagination (journal is
  capped at 200 by default in the page view), the BADGE count SHALL
  be the **total** in the project, not the page-limited count.
- The count badge SHALL render zero as a faint "0" (not hidden), so
  the absence is visible. Loading state SHALL render a small skeleton
  pulse rather than flashing "0".
- The badge SHALL be visually subordinate to the tab label (smaller
  text, muted background, tabular-nums) — it's a hint, not a primary
  identifier.
- The right-edge `+ New experiment` action stays where it is.
- Counts come from the existing per-kind queries already powering
  the views (no new API). For each kind there's already either a
  list endpoint (`/api/experiments?project=...`) or a parsed cache
  whose entry count is the answer (`/api/hypotheses` → entries,
  `/api/journal` with no limit → events). The AppBar SHALL use a
  small, low-staletime React Query that hits the same endpoints used
  by the views (so the cache is shared and counts stay in sync).
- **Warnings indicator: NOT in this change.** A small reserved slot
  next to the count SHALL be present in the markup but rendered empty
  (no DOM children) until a future "warnings system" change fills it.
  The slot SHALL be a sibling of the count badge, on its right edge,
  styled as `inline-flex items-center` so the future change can drop
  in its indicator without re-laying out the tab.

## Capabilities

### Modified Capabilities

- `web-layout`: extend the "Top AppBar with view tab switcher"
  requirement to specify count badges and the reserved slot for the
  future warnings system.

### New Capabilities

(none)

## Impact

- **Code:**
  - `apps/web/components/app-bar.tsx`: extend each tab to render a
    count badge derived from a React Query.
  - Possibly a small `apps/web/lib/api.ts` helper or the hypotheses /
    journal route's response shape augmented with a `total` count if
    the existing payload doesn't already make it cheap to derive.
    (Spoiler: experiments and reports already return a list, so
    `data.experiments.length` works; hypotheses already returns
    `entries.length`; journal needs a check — its payload may already
    expose total.)
- **Specs:** `web-layout` modification only.
- **Tests:** snapshot/render test for `<AppBar>` covering a project
  with various non-zero counts and a project with all zeros.
- **Performance:** five additional client-side queries per AppBar
  render (one per tab). All are already cached by React Query at
  `staleTime: 5_000`, so steady-state cost is one fetch on first
  paint per kind. Negligible.
- **Backward compat:** zero. The AppBar gains badges; nothing else
  changes.
- **Out of scope:**
  - The warnings indicator (its trigger logic, styling, click
    behavior, design system). Tracked as a separate proposal.
  - Changing the source of truth for any count (e.g. server-side
    aggregation). The point is a number visible to the user, not a
    new API endpoint.
  - Counts on the sidebar's per-project rows. AppBar is the scope;
    the sidebar already shows the experiment list expanded so the
    count is visually obvious there.
