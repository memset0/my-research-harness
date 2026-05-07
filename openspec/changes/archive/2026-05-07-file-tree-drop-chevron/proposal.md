## Why

The Files-in-run-dir tree currently puts a `<ChevronRight>` /
`<ChevronDown>` icon BEFORE the folder icon on directory rows. Files
have only one icon (the `<File>`). The chevron pushes the folder's
text-anchor right by ~12px, so file rows under a folder don't line
up vertically with each other (file icons are 12px to the LEFT of
where folder icons start).

The chevron is also redundant — `<Folder>` vs `<FolderOpen>`
already conveys the open/closed state via icon morph.

Drop the chevron to fix the alignment and reduce visual noise.

## What Changes

- `<FileTreeRow>` SHALL NOT render a leading `<ChevronRight>` /
  `<ChevronDown>` on directory rows.
- The expand/collapse state SHALL continue to be conveyed by
  swapping `<Folder>` (closed) ↔ `<FolderOpen>` (expanded) — that
  swap is unchanged.
- The whole row stays the click target.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `experiment-edit`: amend the file-tree requirement to remove the
  chevron clause (it currently pins the chevron).

## Impact

- `apps/web/components/experiment-page.tsx` — drop the
  `<Chevron>` JSX from the directory row, and drop the now-unused
  `ChevronRight` / `ChevronDown` imports.
- No backend, no API, no data shape change.
