## Context

The AppBar lives at `apps/web/components/app-bar.tsx`; per-tab count
badges live at `apps/web/components/tab-badge.tsx`. Both are client
components that read TanStack Query caches by key.

Two implementation realities collide here. First, the v2 list endpoint
that ships runs is reachable as `GET /api/runs` but its TS wrapper is
historically named `fetchExperiments` and the response field is named
`experiments[]` — both holdovers from before the v2/v3 split, which is
why the AppBar count code looks correct at a glance but is actually
counting runs. Second, in v3 the project list page (`/p/<project>`)
shows exp doc cards, and the exp doc detail page lives at
`/p/<project>/e/<id>` — a path the current `Experiments` tab matcher
doesn't recognize.

## Goals / Non-Goals

**Goals:**
- AppBar Experiments badge counts exp docs (matches what the user sees
  on the project root page).
- AppBar Experiments tab highlights on every URL where the user is
  semantically "in the experiments view" (project root, exp detail,
  legacy run detail, legacy v2 detail).

**Non-Goals:**
- Renaming the legacy `fetchExperiments` / `IndexedRun` symbols. They
  bleed across many call sites; one cosmetic fix is in scope, not a
  rename pass.
- Adding count badges to the sidebar (already covered by `web-layout`'s
  existing "Counter badge reflects experiment count" requirement).
- Changing the route layout or adding new pages.

## Decisions

**D1. Switch the badge query to `fetchExperimentDocs` with key
`['experiments', project]`.** The CLAUDE.md spec already names this as
the canonical v3 query key for exp doc data; using the same key as the
detail / list views means a single SSE `experiment-change` invalidation
refreshes all three. Considered: keeping the `['runs', project]` key
and counting runs filtered by `frontMatter.experiment != null` —
rejected because (a) it counts experiment _membership_, not exp docs,
and (b) it leaves the "experiments tab" semantically dependent on run
data, which is exactly the v2/v3 confusion we're paying down.

**D2. Broaden the matcher with one regex-flavored predicate.** The
matcher becomes a check for: `pathname === projectBase` OR
`pathname.startsWith(${projectBase}/e/)` OR
`pathname.startsWith(${projectBase}/r/)` OR
`pathname.startsWith(${projectBase}/experiments)`. Using `startsWith`
with the trailing path separator avoids false-positive matches on a
hypothetical sibling like `/eat-something` or `/reports`. Considered:
matching only `/e/` (the canonical v3 path) — rejected because the
legacy v2 `/experiments/<id>` URL still resolves and the legacy `/r/`
URL is briefly visible during its server redirect.

## Risks / Trade-offs

- [Risk] The `Experiments` tab now renders active on the legacy v2 URL
  `/p/<project>/experiments/<id>`. → Mitigation: this is the desired
  behavior — those URLs are still served and the tab semantically
  applies to them. The legacy URL itself is unchanged.
- [Risk] Switching the query key drops a stale `['runs', project]`
  cache entry from being shared between the badge and any view that
  still uses it. → Mitigation: nothing else used the badge's
  `['runs', project]` cache as a primary source — every view that
  reads runs already owns its own cache entry; the badge just happened
  to piggyback. After this change the badge reads from the exp doc
  cache instead.

## Migration Plan

No data or schema migration. Code-only edit; build + restart the prod
server (per CLAUDE.md "Dev: prefer prod build for the dashboard")
picks up the new behavior immediately. No backout beyond `git revert`.

## Open Questions

None.
