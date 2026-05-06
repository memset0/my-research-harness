## 1. Code edits

- [x] 1.1 In `apps/web/components/app-bar.tsx`, change the `<header>`
  className: removed `h-12`, added `min-h-12 py-1.5`.
- [x] 1.2 Same file, `<nav>` className: added `flex-1 flex-wrap
  min-w-0` (kept the existing `flex items-center gap-1`).

## 2. Verification

- [x] 2.1 `pnpm --filter @memon/web typecheck` passes.
- [x] 2.2 Rebuilt the web bundle and restarted the prod server.
- [x] 2.3 SSR HTML check on `/p/project-a`:
  - `<header>` carries
    `flex min-h-12 shrink-0 items-center gap-2 border-b bg-background px-3 py-1.5 md:px-4`
    — `h-12` is absent. ✓
  - `<nav role="tablist">` carries
    `flex flex-1 flex-wrap items-center gap-1 min-w-0`. ✓
- [x] 2.4 Compiled CSS (`apps/web/.next/static/css/<hash>.css`)
  contains generated rules for `.min-h-12`, `.flex-wrap`, `.flex-1`,
  `.min-w-0`, and `.py-1\.5`. ✓
