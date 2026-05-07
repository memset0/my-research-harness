## Context

The current file-tree row JSX:

```tsx
<li … onClick={…}>
  {!isRoot && <Chevron className="size-3 …" />}
  <FolderIcon className="size-3.5 …" />
  <span>{label}</span>
  {!isRoot && <span>({childCount})</span>}
</li>
```

Files render only `<File className="size-3.5 …" />` then the label.
So under a folder, files start at `paddingLeft + size-3.5`, while
the folder itself starts at `paddingLeft + size-3 (chevron) + size-3.5
(folder)`. The misalignment is one chevron-width.

## Goals / Non-Goals

**Goals:**
- All rows (file + folder) at the same depth share an x-coordinate
  for their icon and their label.
- The expanded vs collapsed state remains visually obvious.

**Non-Goals:**
- Don't change the indent scale (stays at `16px` per depth).
- Don't replace the Folder / FolderOpen pair with anything else;
  they already encode the state.
- Don't add a hidden chevron-width spacer to "preserve" the column.
  The user's complaint is the column shouldn't exist at all.

## Decisions

**D1. Drop the chevron entirely; rely on Folder ↔ FolderOpen
morph.** This is the minimal cleanup that achieves the requested
alignment.

**D2. Remove the unused imports.** `ChevronRight` and `ChevronDown`
are no longer referenced in this file (they aren't used elsewhere
in `experiment-page.tsx`). Drop them from the
`'lucide-react'` import.

## Risks / Trade-offs

- [Risk] First-time users may miss the click affordance without
  the chevron. → Mitigation: the row already has
  `cursor-pointer hover:bg-muted/40` and the Folder ↔ FolderOpen
  swap is a clear visual signal. The descendant count `(N)` next
  to the name is also a signal that there's more inside.

## Migration Plan

Code-only edit.

## Open Questions

None.
