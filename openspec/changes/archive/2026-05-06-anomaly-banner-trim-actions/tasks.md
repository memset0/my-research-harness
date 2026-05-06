## 1. Code edits

- [x] 1.1 In `apps/web/components/anomaly-banner.tsx`:
  - Drop the `EyeOff` import from `lucide-react`.
  - Drop `HIDE_KEY_PREFIX` and the `useState` / `useEffect` /
    `sessionStorage` machinery for `hidden`.
  - Drop the `Hide` button entirely.
  - Wrap the remaining `Copy all` button in `<CardAction>` (imported
    from `./ui/card`) so it lands in the header's right column.
  - Remove `flex-row items-center justify-between gap-2 space-y-0
    py-3` from the `CardHeader` className.
  - Remove `pt-0` from the `CardContent` className.
  - The early-return for `anomalies.length === 0` stays. The
    early-return for `hidden` is removed alongside the state.

## 2. Verification

- [x] 2.1 `pnpm --filter @memon/web typecheck` passes.
- [x] 2.2 Rebuilt the prod web bundle (`pnpm --filter @memon/web
  build`) and restarted the prod server. Identified the bundled
  chunk for the project list page
  (`apps/web/.next/static/chunks/app/p/[project]/page-…js`).
- [x] 2.3 Inspected the compiled banner JSX in that chunk. It
  shows: `Card className="border-amber-400/70"`, `CardHeader`
  with no className override, `CardTitle` with `flex items-center
  gap-2 text-sm`, a single Button wrapped in `CardAction` (which
  renders `data-slot="card-action"`), and `CardContent` with no
  className override (no `pt-0`).
- [x] 2.4 Checked the bundled chunk has 0 occurrences of
  `EyeOff`, `HIDE_KEY_PREFIX`, `memon:anomaly-banner-hidden`, and
  `sessionStorage` — confirming the dead code is gone (not just
  hidden behind a branch).
- [x] 2.5 The banner body is preserved: the JSX still emits
  `<span>{count} issue{s? :' '} need resolution</span>` and the
  per-anomaly list (`code · run=… · exp=… — message`). Verification
  via the bundled JSX output, since the banner only renders client-
  side after `useQuery` resolves and the SSR HTML doesn't include it.
