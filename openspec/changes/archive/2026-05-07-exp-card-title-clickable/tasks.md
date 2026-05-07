## 1. Code edits

- [x] 1.1 In `apps/web/components/experiment-card-grid.tsx`, wrapped
  the title `<h3>` in a `<Link href={…}>` pointing at the same
  `/p/<project>/e/<exp.id>` URL the E-id link uses. Link className
  carries `hover:underline`. The `<h3>` keeps its
  `truncate text-sm font-medium` typography.

## 2. Verification

- [x] 2.1 `pnpm --filter @memon/web typecheck` passes.
- [x] 2.2 Rebuilt the web bundle and restarted the prod server.
- [x] 2.3 Compiled chunk
  `apps/web/.next/static/chunks/app/p/[project]/page-…js` shows the
  card header containing TWO Link calls with the same href
  (`encodeURIComponent(d)/e/${encodeURIComponent(l.id)}`):
  1. `className: "truncate font-mono text-xs text-muted-foreground hover:underline", children: l.id`
  2. `className: "hover:underline", children: <h3 …>{l.frontMatter.title}</h3>`
  Both Links navigate to the same exp detail URL.
