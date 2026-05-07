## 1. Code edits

- [x] 1.1 In `apps/web/components/experiment-page.tsx`, dropped the
  `<Chevron …/>` JSX from the directory branch of `<FileTreeRow>`
  along with the `const Chevron = expanded ? ChevronDown : ChevronRight`
  binding.
- [x] 1.2 Dropped `ChevronDown` and `ChevronRight` from the
  `'lucide-react'` import.

## 2. Verification

- [x] 2.1 `pnpm --filter @memon/web typecheck` passes.
- [x] 2.2 Rebuilt and restarted the prod server.
- [x] 2.3 Compiled chunk
  `apps/web/.next/static/chunks/app/p/[project]/e/[id]/page-…js`:
  - `ChevronRight` / `ChevronDown` / `chevron-right` / `chevron-down`
    occurrences: 0 ✓ (the icons are not in this chunk anymore).
  - The lucide registered names `"file"`, `"folder"`, `"folder-open"`
    are still present.
  - The conditional `?c:x,{className:"size-3.5...` proves the
    `expanded ? FolderOpen : Folder` ternary is preserved in the
    compiled JSX.
