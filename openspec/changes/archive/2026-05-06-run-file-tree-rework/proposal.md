## Why

The "Files in run dir" tree on the v3 exp detail page is rough:

1. **Path duplication.** The API returns each tree node's `path`
   relative to the run-dir root (`logs/stdout.log` for a file inside
   `logs/`). The current `<FileTree>` displays `node.path` verbatim,
   so the parent name shows up twice — once on the dir row, once
   inside every child's path. A two-level tree reads as:
   ```
   📁 logs
      📄 logs/stdout.log
      📄 logs/stderr.log
   ```
   The tree's hierarchy already conveys that the children belong to
   `logs/`; the redundant prefix is just noise.
2. **Emoji icons.** `📄` and `📁` look out of place next to shadcn's
   lucide-icon style throughout the rest of the dashboard.
3. **Indent is too tight.** 8px per depth doesn't make hierarchy
   scannable at a glance.
4. **No folder counts.** Hard to tell at a glance which folders have
   meaningful contents.
5. **No collapse/expand.** Once a run dir gets big, the whole tree
   blurs into one wall.

## What Changes

- The file-tree `<FileTree>` component SHALL render only the **last
  path segment** (basename) for every node, not the full relative
  path. The root SHALL still render as `(run dir)` since `.` is
  meaningless to humans.
- `<FileTree>` SHALL use lucide icons (`Folder`, `FolderOpen`,
  `File`, `ChevronRight`, `ChevronDown`) instead of the Unicode emoji.
- Per-depth indent SHALL increase from `8px` to `16px` so each
  level's offset is roughly the width of the new icon set.
- Each folder SHALL display a recursive count of its descendants
  (files + subdirs, all levels) as a small muted badge to the right
  of its name.
- Folders SHALL be expandable / collapsible via a click on the row
  (entire row becomes the toggle). Default state:
  - Folder with **> 10 recursive descendants** → collapsed by default.
  - Otherwise → expanded by default.
  - The root (`.`) is always expanded; clicking it does nothing.
- The currently-truncated state from the API (`files.truncated`) SHALL
  continue to render its `(truncated)` indicator next to the section
  heading; that's orthogonal.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `experiment-edit`: extend the "Run-panel actions inside the exp
  detail page" requirement (or add a sibling requirement on the file
  tree widget) to pin the new visual + interaction contract.

## Impact

- `apps/web/components/experiment-page.tsx` — rework the local
  `<FileTree>` component. Add `useState` for per-folder expand
  state. Add a small recursive-count helper. Swap icons.
- No API change. The existing `/api/runs/:id/files?depth=…` is
  sufficient.
- No backend or data-shape change.
