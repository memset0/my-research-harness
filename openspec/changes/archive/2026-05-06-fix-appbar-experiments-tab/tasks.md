## 1. Code edits

- [x] 1.1 In `apps/web/components/tab-badge.tsx`, change
  `useExperimentsCount` to query `fetchExperimentDocs(project)` under
  the canonical v3 key `['experiments', project]`. Return
  `q.data?.experiments.length` from the v3 endpoint shape (the field
  name on `/api/experiments` is also `experiments[]` but holds exp doc
  summaries, not runs).
- [x] 1.2 In `apps/web/components/app-bar.tsx`, broaden the
  `Experiments` tab's `matches` predicate to fire on:
  - `pathname === projectBase`
  - `pathname.startsWith(`${projectBase}/`)` AND first segment after
    the base is `e`, `r`, or `experiments` (use a small helper or
    explicit `startsWith` triple to avoid false positives like a
    sibling `eats/` segment).

## 2. Verification

- [x] 2.1 `pnpm --filter @memon/web typecheck` passes.
- [x] 2.2 The prod web server is running on port 3737 (rebuilt +
  restarted per CLAUDE.md "Dev: prefer prod build" — `tsx server.ts`
  in dev mode wasn't picking up the file change because of the
  cluster's inotify limit, so a clean prod rebuild was the safe path).
- [x] 2.3 SSR HTML inspection across 5 URLs (`/p/project-a`,
  `/p/project-a/e/<id>`, `/p/project-a/e/<id>?run=…`,
  `/p/project-a/hypotheses`, `/p/project-a/reports`) confirms the
  Experiments tab is `aria-selected="true"` + `data-variant="default"`
  on the first three and `aria-selected="false"` on the latter two.
- [x] 2.4 Independent count check on `project-a`: `/api/experiments`
  returns 5 exp docs, `/api/runs` returns 8 runs. The compiled web
  bundle (`/_next/static/chunks/app/p/[project]/layout-…js`) shows
  the badge `useQuery` keyed on `["experiments", n]` calling
  `fetchExperimentDocs` (`/api/experiments?project=…`) — proving the
  badge fetches the exp-doc count (5), not the run count (8).
- [x] 2.5 The negative scenario is covered by 2.3 — on `/hypotheses`
  the Experiments tab is rendered with `aria-selected="false"` and
  `data-variant="ghost"`.
