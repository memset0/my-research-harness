## 1. Code edits

- [x] 1.1 In `apps/web/lib/api.ts`, added `fetchRunReadme(id)` mirroring
  `fetchExpDocReadme`: GET `/api/runs/:id` → join `${detail.path}/README.md`
  → call `fetchReadme(...)`.
- [x] 1.2 In `apps/web/components/readme-editor.tsx`, extended
  `loadFromDisk` to dispatch on `target.kind === 'run'` and call
  `fetchRunReadme(target.id)`. Exp-doc and legacy fallback branches
  unchanged.

## 2. Verification

- [x] 2.1 `pnpm --filter @memon/web typecheck` passes.
- [x] 2.2 Rebuilt the web bundle and restarted the prod server.
- [x] 2.3 Reproduced the EISDIR baseline directly:
  - `GET /api/readme?path=<run-dir>` →
    `{"error":{"message":"EISDIR: illegal operation on a directory, read"}}`
  Then verified the fix path:
  - `GET /api/readme?path=<run-dir>/README.md` returns 200 with
    `{ path, mtime, hash, content }` where `content` begins with the
    real README frontmatter (`---\nid: sub-recipe-260504-110000\n…`).
- [x] 2.4 Confirmed the compiled chunk contains the
  `${detail.path}/README.md` join inline (visible as
  `"".concat(e.path,"/README.md")` in the minified output) — proving
  `fetchRunReadme` shipped, not stale.
