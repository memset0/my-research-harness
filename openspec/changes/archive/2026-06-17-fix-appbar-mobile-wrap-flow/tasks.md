## 1. Restructure AppBar into one shared wrap flow

- [x] 1.1 In `apps/web/components/app-bar.tsx`, keep the `<header>` a
      non-wrapping `flex items-center gap-2` row and keep `<SidebarTrigger />`
      as its first (fixed, left) child OUTSIDE the wrap flow. Add an inner
      wrap container `<div className="flex flex-1 flex-wrap items-center
      gap-1 min-w-0">` holding the tabs + right controls.
- [x] 1.2 Change the `<nav role="tablist">` className from
      `flex flex-1 flex-wrap items-center gap-1 min-w-0` to `contents` so its
      child tab buttons join the inner wrapper's flex-wrap flow; keep
      `role="tablist"` and the `tabs.map(...)` body unchanged.
- [x] 1.3 Wrap `<ManageSharesDialog />` and `<OpenWithButton />` in a single
      group `div` with `className="ml-auto flex items-center gap-1"` so they
      stay together and right-align per flex line.
- [x] 1.4 Update the in-file explanatory comment to describe the new
      single-flow structure while RETAINING the "do NOT add overflow-x-auto"
      warning (the stray-scrollbar hazard still applies).

## 2. Fix the Code Review label

- [x] 2.1 Change the code-review tab's `name: 'Code review'` to
      `name: 'Code Review'` (AppBar tab label only; leave page `<title>` /
      `<h1>` strings elsewhere untouched).

## 3. Verify

- [x] 3.1 `pnpm --filter @memon/web typecheck` passes.
- [x] 3.2 Rebuild + prod-start the dashboard per CLAUDE.md (kill old PID on
      3737 first, then `pnpm --filter @memon/web build` + `pnpm start`).
- [x] 3.3 F1 markup check: `curl -u "$MEMON_USER:$MEMON_PASS"` a project page
      (e.g. `/p/<project>`), grep the served HTML for the AppBar markup —
      confirm `role="tablist"`, the six tab labels including `Code Review`,
      and the `ml-auto` right-group container are present.
- [x] 3.4 Narrow-viewport sanity: confirm (preview tool if available, else
      inspect the rendered markup/classes) that on a small width the tabs
      wrap as one flow and the right control group lands right-aligned on the
      last line — not pinned vertically-centered against a multi-row tab
      block.
- [x] 3.5 Wide-viewport sanity: single-row layout matches the prior look
      (tabs left, controls pushed right by `ml-auto`).
