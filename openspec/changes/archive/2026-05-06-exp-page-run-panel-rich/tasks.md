## 1. Code edits

- [x] 1.1 In `apps/web/components/experiment-page.tsx`, imported the
  legacy components into the v3 page: `StatusEdit`, `TerminalButton`,
  `AddNoteButton`, `WarningsCard`, `LogViewer`, plus
  `TimestampLocal` and the `FullExperiment` type.
- [x] 1.2 Rewrote `RunBody` to render in order:
  `<RunFrontmatterCard>`, action bar, Setup, Result, `<WarningsCard>`,
  per-run `<RunArtifactsBlock>`, `<LogViewer>`, `<FileTree>`.
- [x] 1.3 Added inline helpers: `<RunFrontmatterCard>` (the legacy
  field grid + StatusEdit), `<FmField>` / `<FmLabel>` for label-value
  rows, and `<RunArtifactsBlock>` for the per-run artifact list.
- [x] 1.4 Removed the "Open run page (legacy)" link.
- [x] 1.5 Tightened typography: `text-[10px]` for muted labels,
  `text-[11px]` for monospace values, `text-xs` for secondary text.

## 2. Verification

- [x] 2.1 `pnpm --filter @memon/web typecheck` passes.
- [x] 2.2 Rebuilt the web bundle and restarted the prod server.
- [x] 2.3 SSR smoke-test:
  - `GET /p/project-a/e/E0001-vpred-convergence` → 200
  - `GET /p/project-a/e/E0001-vpred-convergence?run=…` → 200
  - The literal `Open run page (legacy)` does NOT appear in the
    SSR HTML.
- [x] 2.4 Compiled-chunk verification:
  - The v3 page chunk
    `apps/web/.next/static/chunks/app/p/[project]/e/[id]/page-…js`
    contains the frontmatter labels `name`, `created`, `finished`,
    `host`, `pid`, `gpus`, `entry`, `command`, `wandb`, `tags`,
    `hypotheses` (one each).
  - The shared chunk `apps/web/.next/static/chunks/1755-…js`
    (transitively imported by the v3 page) contains the API URL
    string literals for: `/api/runs/.*/status` (StatusEdit),
    `/api/log-files?expPath=` and `/api/log?` (LogViewer),
    `/api/runs/.*/warnings` (WarningsCard), `/api/terminal/*`
    (TerminalButton), and `/api/journal/append` (AddNoteButton →
    AddEventModal). All run-panel components are bundled.
- [x] 2.5 Frontmatter shape sanity: `GET /api/runs/<id>` returns the
  fields the panel renders (verified manually for runs in
  project-a fixtures).
