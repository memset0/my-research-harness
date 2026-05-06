## 1. Code edits

- [x] 1.1 In `apps/web/components/inbox-shell.tsx`, added
  `overflow-x-hidden` to the right-pane `<main>` className.
  Final: `min-w-0 flex-1 overflow-y-auto overflow-x-hidden`.
- [x] 1.2 Same file, added `overflow-x-hidden` to the inner content
  scroll `<div>`.
  Final: `overflow-y-auto overflow-x-hidden` (plus the existing
  `min-w-0 flex-1`).

## 2. Verification

- [x] 2.1 `pnpm --filter @memon/web typecheck` passes.
- [x] 2.2 Rebuilt the web bundle and restarted the prod server.
- [x] 2.3 SSR HTML check on `/p/project-a/reports/R0001`:
  - `<main class="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">` ✓
  - inner `<div class="overflow-y-auto overflow-x-hidden min-w-0 flex-1">` ✓
- [x] 2.4 Compiled CSS at
  `apps/web/.next/static/css/4b042cd8754a185d.css` contains the
  rule `.overflow-x-hidden{overflow-x:hidden}` — the utility was
  generated and isn't a no-op. ✓
- [x] 2.5 Same shell powers the digests detail page; the same
  classes apply there by code-share (the InboxShell component is
  unchanged across kinds).
