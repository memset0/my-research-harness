## 1. Code edits

- [x] 1.1 In `apps/web/components/experiment-page.tsx`, imported
  `Collapsible`, `CollapsibleContent`, `CollapsibleTrigger` from
  `./ui/collapsible`.
- [x] 1.2 Replaced `<details>` / `<summary>` in `RunPanel` with
  `<Collapsible open onOpenChange>` / `<CollapsibleTrigger asChild>` /
  `<CollapsibleContent className="overflow-hidden
  data-[state=open]:animate-collapsible-down
  data-[state=closed]:animate-collapsible-up">`. Used `asChild` to
  forward the trigger props onto the existing summary-row `<div>` so
  the StatusPill (also a button-like element) doesn't end up nested
  in a button.
- [x] 1.3 Removed the `onToggle` event handler and the `open && …`
  conditional render guard. Radix keeps the content mounted with
  `hidden=""` when closed; this is a positive change (the
  LogViewer's fetched logs aren't refetched on every reopen).

## 2. Verification

- [x] 2.1 `pnpm --filter @memon/web typecheck` passes.
- [x] 2.2 Killed the stale prod server (it had been running ~62
  minutes with the bug-3 build), rebuilt, and restarted.
- [x] 2.3 Compiled chunk
  `apps/web/.next/static/chunks/app/p/[project]/e/[id]/page-…js`
  contains the literal CollapsibleContent JSX:
  ```
  className:"overflow-hidden data-[state=open]:animate-collapsible-down
              data-[state=closed]:animate-collapsible-up"
  ```
- [x] 2.4 Compiled CSS at
  `apps/web/.next/static/css/7ebe588f997330a7.css` contains:
  - `@keyframes collapsible-down{0%{height:0}to{height:var(--radix-collapsible-content-height,…)}}`
  - `@keyframes collapsible-up{…to{height:0}}`
  - The data-attribute-prefixed rule
    `.data-\[state\=open\]\:animate-collapsible-down[data-state=open]{animation: collapsible-down …}`
- [x] 2.5 SSR check on
  `/p/project-a/e/E0001-vpred-convergence?run=vpred-baseline-260501-100000`
  returns 200, contains 0 `<details>` elements, and contains
  `data-slot="collapsible"` / `data-slot="collapsible-content"` plus
  `data-state="open"` / `data-state="closed"` attributes (the latter
  set by Radix). The exact CollapsibleContent className is not
  visible in SSR because the run panel only renders after the
  client query resolves; the bundle-level evidence (2.3) is the
  authoritative wiring check for that layer.
