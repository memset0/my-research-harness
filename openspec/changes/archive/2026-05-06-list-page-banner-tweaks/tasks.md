## 1. Code edits

- [x] 1.1 In `apps/web/components/experiment-card-grid.tsx`, swap the
  JSX order so the `<h2>Experiments (N)</h2>` heading is rendered
  BEFORE the `<AnomalyBanner />`. The grid stays last. The wrapping
  `<div className="flex flex-col gap-4 p-4 md:p-6">` stays.
- [x] 1.2 In `apps/web/components/anomaly-banner.tsx`, change
  `max-h-[40vh]` to `max-h-[20vh]` on the scrollable `<ul>`.

## 2. Verification

- [x] 2.1 `pnpm --filter @memon/web typecheck` passes.
- [x] 2.2 Rebuilt the web bundle (`pnpm --filter @memon/web build`)
  and restarted the prod server.
- [x] 2.3 Inspected the compiled chunk
  `apps/web/.next/static/chunks/app/p/[project]/page-*.js`. The
  `ExperimentCardGrid` wrapper `<div class="flex flex-col gap-4
  p-4 md:p-6">` has children in this order: `<h2>Experiments
  (N)…</h2>`, then the `AnomalyBanner` JSX call (`jsx(h,{project:n})`),
  then the grid `<div class="flex flex-col gap-3">`. ✓
- [x] 2.4 The same chunk's `max-h-` class set is `{max-h-[20vh]}` —
  `max-h-[40vh]` is no longer in the bundle. ✓
