## 1. Backend: journal totalEvents shortcut

- [x] 1.1 In `apps/web/app/api/journal/route.ts`, when `?countOnly=1` is present, short-circuit and return `{ totalEvents: number, lastDigestAt: string | null }` (skip the events array entirely). Reuse the runtime cache. Test by curl.
- [x] 1.2 Mirror in `apps/web/lib/server/data.ts` if SSR ever needs the count (likely not — this is a client-side AppBar concern).

## 2. Frontend: TabBadge helper

- [x] 2.1 Add `apps/web/components/tab-badge.tsx`. Props: `kind: 'experiments' | 'hypotheses' | 'journal' | 'reports' | 'digests'`, `project: string`. Mounts the same `useQuery` the corresponding view uses (same key, same fetcher) so the cache is shared.
- [x] 2.2 Render rule:
  - `query.isLoading && !data` → `<span class="inline-block h-3 w-4 animate-pulse rounded bg-muted" />`
  - otherwise → `<span class="ml-1 text-[10px] tabular-nums text-muted-foreground">{count}</span>`
- [x] 2.3 After the count span, render `<span data-slot="warnings" className="inline-flex" />` as the reserved slot for future warnings indicator. No children today.

## 3. AppBar integration

- [x] 3.1 In `apps/web/components/app-bar.tsx`, wrap each tab's label with a flex container that holds the label, the `<TabBadge kind=... project={project} />`, and the warnings slot. Tab order remains unchanged.
- [x] 3.2 Reports and Digests tabs (added by `inbox-reports-and-digests`) automatically pick up badges via the same TabBadge helper.

## 4. Tests

- [x] 4.1 Snapshot/render test for `<AppBar>` with a mocked QueryClient: counts populated, zero counts (renders `0` faintly), loading (renders skeletons), all five kinds active.
- [x] 4.2 Verify `data-slot="warnings"` element is present in the rendered DOM next to each count.

## 5. Verification + commit

- [x] 5.1 `pnpm --filter @memon/web typecheck` clean.
- [x] 5.2 `pnpm --filter @memon/web test` clean.
- [x] 5.3 Smoke against the running dev server: open `/p/project-a` and confirm the AppBar shows e.g. `Experiments 8 · Hypotheses N · Journal M`. Switch projects; counts update.
- [x] 5.4 `openspec validate appbar-tab-counts --type change` clean.
- [x] 5.5 Commit. Body should call out that the warnings slot is intentionally empty — points at the future warnings-system change.
