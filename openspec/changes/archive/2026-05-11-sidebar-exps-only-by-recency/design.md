## Context

The project sidebar lives in `apps/web/components/app-sidebar.tsx`. Per
project, when the group is expanded, the current implementation renders:

1. `ProjectExperimentDocs` — v3 exp doc list (calls `fetchExperimentDocs`,
   which hits `GET /api/experiments?project=…`). Rows link to
   `/p/<project>/e/<exp-id>`.
2. `ProjectExperiments` — legacy v2 run list (calls `fetchExperiments`,
   which hits a different route returning `IndexedRun` rows). Rows link
   to `/p/<project>/experiments/<run-id>` (a v2 path).

The `web-layout` spec describes only ONE sub-section (experiments,
sorted by `effective_updated_at` desc), and explicitly says runs are
reachable only through their parent experiment. The `Runs` sub-section
is therefore an implementation drift that should not exist. The exp
list page (`experiment-card-grid.tsx`) does sort by `effectiveUpdatedAt`
desc; the sidebar does not. Fixing the sidebar in line with the spec
makes both surfaces consistent.

## Goals / Non-Goals

**Goals:**
- The sidebar renders **exactly one** sub-section per expanded project:
  the experiments list. The Runs sub-section is removed.
- Experiments are sorted by `effectiveUpdatedAt` descending so the most
  recent activity bubbles to the top.
- The `web-layout` spec is tightened so the implementation can't drift
  back: (a) requirement title agrees with body, (b) explicit "no Runs
  sub-section" line, (c) explicit sort key + direction.
- Existing pagination (5 + `View more`) and the right-side
  `runs.length` count badge are preserved.
- Existing sidebar tests continue to pass after a small mock swap;
  one new test asserts sort order.

**Non-Goals:**
- Changing how runs are surfaced anywhere else (orphan run cards on
  the project list page, run panels inside an exp doc detail page,
  `/manage/...` pages all stay as-is).
- Removing `fetchExperiments` / `IndexedRun` from the codebase. They
  remain used by other components.
- Changing pagination behavior or right-side badge.
- Reworking the sidebar's collapse/expand persistence, active-row
  highlighting, or mobile/drawer behavior.
- Altering the `GET /api/experiments` response shape.

## Decisions

### D1. Drop `Runs` sub-section entirely (rather than guard with a flag)

Rejected alternative: keep the `ProjectExperiments` component behind
a feature flag or a config toggle. Rejected because (a) the spec is
unambiguous about there being no separate Runs sub-section, (b) the
information is already reachable via the exp doc detail page where
each run gets its own panel, (c) feature flags add carrying cost in
test surface and code paths for what is a clear semantic decision.

### D2. Sort with `localeCompare` on the ISO8601 string

`effectiveUpdatedAt` is an ISO8601-with-offset string (e.g.
`2026-05-04T10:00:00+08:00`). Lexicographic ordering matches
chronological ordering as long as all timestamps share the same
shape, which is the project-wide invariant per
`openspec/specs/experiment-readme/spec.md` ("All timestamps ISO8601
with timezone offset"). `localeCompare` is what
`experiment-card-grid.tsx` already uses; we mirror it for surface
parity.

Rejected alternative: parse to `Date` then subtract numeric
timestamps. Slightly more code, no behavioral win, and breaks the
"two surfaces sort the same way" symmetry.

### D3. Drop the `Experiments` sub-header label

The `<div>Experiments</div>` (uppercase tracking-wide caption above
the list) was useful when there were two sub-sections to
disambiguate. With only one, it's pure visual noise — the project
group header (`name` line, e.g. `project-a`) already establishes
context. Dropping the label reduces vertical density a little, which
matters when 5 exp rows + a `View more` already crowd a narrow
sidebar.

### D4. Don't touch the `runs.length` right-side badge

The badge shows the number of runs bound to each exp. Useful at-a-
glance signal even after dropping the runs list — "is this exp
multi-run or single-run". The user explicitly chose to keep it.

### D5. Test additions: minimum viable

The existing tests (`app-sidebar.test.tsx`) cover (a) active project
opens by default, (b) toggle persistence. Both still hold. We
add ONE new test: `renders experiment rows sorted by
effectiveUpdatedAt descending`. We swap `fetchExperiments` →
`fetchExperimentDocs` in the existing mock setup.

We do NOT add a test that asserts the Runs sub-section is absent
(that's covered structurally — the component is deleted from the
file; you can't accidentally render what isn't imported).

## Risks / Trade-offs

- **[Risk] Power-users relied on the sidebar Runs list as a quick
  pre-v3 jumping-off point.**
  → Mitigation: the v2 path (`/p/<project>/experiments/<run-id>`)
  already redirects to the v3 exp page (per `web-dashboard` spec
  "URL redirects from legacy run paths"). Even if a user had a
  bookmark, navigation still works. The sidebar list was the
  *discovery* path; discovery now goes via the exp list.
- **[Risk] Sort by `effectiveUpdatedAt` could surface "noisy"
  experiments (auto-bumped by background processes) above the one
  the user actually wants.**
  → Mitigation: this is the same risk the exp grid already accepts;
  matching its behavior is the point of the change. If the noise
  is real, it'd be addressed at the source (what bumps
  `updated_at`), not by inventing a separate sort for the sidebar.
- **[Trade-off] Deleting `ProjectExperiments` removes the only
  sidebar consumer of `fetchExperiments` / `IndexedRun`. Both
  symbols stay in `apps/web/lib/api.ts` because other components
  still consume them.** No dead code added.

## Migration Plan

1. Delete `ProjectExperiments` from `apps/web/components/app-sidebar.tsx`.
2. Drop the `fetchExperiments` and `IndexedRun` imports from that file.
3. Drop the `<ProjectExperiments .../>` JSX line and the
   `Experiments` sub-header `<div>` from `ProjectGroup`.
4. Add `.slice().sort(...)` inside `ProjectExperimentDocs` so the
   rendered list is sorted by `effectiveUpdatedAt` desc.
5. Update `app-sidebar.test.tsx` mock setup to use
   `fetchExperimentDocs` instead of `fetchExperiments`.
6. Add a sort-order test.
7. Update `openspec/specs/web-layout/spec.md` per the spec deltas.
8. Verify in browser per CLAUDE.md F1: open the dashboard, expand a
   project with ≥2 exp docs, confirm only one sub-section renders
   and the rows are in `updatedAt`-descending order.

## Open Questions

- None. Both pagination and badge decisions are locked from the
  pre-propose AskUserQuestion round.
