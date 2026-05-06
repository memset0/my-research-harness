## 1. Code edits

- [x] 1.1 Inside `apps/web/components/experiment-page.tsx`, rewrote
  `<FileTree>` (and added `<FileTreeRow>` + helpers `basename` and
  `countDescendants`):
  - basename via `path.split('/').pop()`; root rendered as
    `(run dir)`.
  - lucide icons (`File`, `Folder`, `FolderOpen`, `ChevronRight`,
    `ChevronDown`) — emoji removed.
  - per-depth indent `16px`.
  - per-folder expand state via a top-level `useState<Record<string,
    boolean>>` keyed by node path; default state derived from
    recursive descendant count (`> 10` → collapsed).
  - whole folder row is the click target.
  - root row is always-expanded and not clickable.

## 2. Verification

- [x] 2.1 `pnpm --filter @memon/web typecheck` passes.
- [x] 2.2 Rebuilt the web bundle and restarted the prod server.
- [x] 2.3 Real fixture run with subdirs available
  (`snr-sweep-260430-160000` returns nested `logs/stdout.log`-style
  paths from `/api/runs/:id/files`).
- [x] 2.4 Inspected the compiled chunk
  `apps/web/.next/static/chunks/app/p/[project]/e/[id]/page-…js`:
  - 0 occurrences of the literal emoji `📁` / `📄`.
  - The `(run dir)` literal is present.
  - The basename helper is inlined as
    `function(e){let n=e.split("/").pop();return n&&n.length>0?n:e}`.
  - The descendant counter is inlined; the threshold check appears
    as `let g=h||x<=10` (root OR count ≤ 10 → expanded).
  - The override lookup appears as `null!=(n=o[a.path])?n:g`.
  - The onClick toggles via `m(a.path,g)` (folders only — file
    rows have no onClick).
  - Indent is `16*r` (16px per depth) — matches spec.
