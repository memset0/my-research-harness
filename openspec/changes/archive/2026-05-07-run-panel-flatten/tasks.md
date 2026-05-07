## 1. Code edits

- [x] 1.1 In `apps/web/components/experiment-page.tsx`, dropped the
  `WarningsCard` import.
- [x] 1.2 Restructured `RunBody`'s return into three stripe `<div>`
  blocks (action / frontmatter / body), each with `border-t p-3`,
  rendered as direct children inside a `<>` fragment so the
  `<CollapsibleContent>` reads them as flat siblings.
- [x] 1.3 Action stripe contains: EditMarkdownButton,
  OpenClaudeCodeButton, TerminalButton, AddNoteButton, StatusEdit
  (or "no README" Badge fallback), and the parse-errors Badge.
- [x] 1.4 Frontmatter stripe is now just the `<dl>` grid (no
  enclosing card chrome and no id+status header row). The function
  was renamed from `RunFrontmatterCard` to `RunFrontmatterStripe`
  and now returns the dl directly.

## 2. Verification

- [x] 2.1 `pnpm --filter @memon/web typecheck` passes.
- [x] 2.2 Rebuilt the web bundle and restarted the prod server.
- [x] 2.3 Source spot-check: `grep WarningsCard
  apps/web/components/experiment-page.tsx` → 0 hits;
  `grep "border-t p-3"` → 4 hits (3 stripes + 1 loading
  placeholder; the placeholder shares the rhythm intentionally).
- [x] 2.4 Compiled chunk
  `apps/web/.next/static/chunks/app/p/[project]/e/[id]/page-…js`
  shows the four `border-t p-3` className strings (loading +
  action + frontmatter + body) and zero references to
  `fetchWarnings` or `/api/runs/.*/warnings`.
- [x] 2.5 SSR check on
  `/p/project-a/e/E0001-vpred-convergence?run=vpred-baseline-260501-100000`
  returns 200.
