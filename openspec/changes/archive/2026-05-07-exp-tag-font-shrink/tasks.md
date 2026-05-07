## 1. Code edits

- [x] 1.1 In `apps/web/components/experiment-page.tsx`, changed the
  page-header tag Badge className from `text-xs` to `text-[10px]`.
- [x] 1.2 In `apps/web/components/experiment-card-grid.tsx`, changed
  the card-footer tag Badge className from `text-xs` to
  `text-[10px]`.

## 2. Verification

- [x] 2.1 `pnpm --filter @memon/web typecheck` passes.
- [x] 2.2 Rebuilt the web bundle and restarted the prod server.
- [x] 2.3 Compiled chunk for the project list page contains
  `variant:"outline",className:"text-[10px]",children:["#",e]` —
  the tag-Badge JSX with the new size token.
- [x] 2.4 Compiled chunk for the exp detail page contains the same
  pattern; no `text-xs` Badge with a `#`-prefixed child remains in
  either chunk.
- [x] 2.5 Compiled CSS contains `.text-\[10px\]{font-size:10px}`.
