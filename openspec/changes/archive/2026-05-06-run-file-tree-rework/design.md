## Context

`/api/runs/:id/files?depth=N` returns a `RunFileTreeNode`:

```ts
{ type: 'file'|'dir', path: string, size?, mtime?, children?: [] }
```

`path` is **relative to the run dir root** and contains the entire
sub-path, e.g. `"logs/stdout.log"`. The component renders that string
directly. Because parents already show their own path, every child
inherits the parent's prefix in its rendered text.

The component is small (~20 lines) and lives inline at the bottom of
`experiment-page.tsx`. There's no dedicated capability spec for it
today.

## Goals / Non-Goals

**Goals:**
- Each row shows just the basename of its node.
- Visual style matches the rest of the dashboard (lucide icons +
  shadcn-flavored typography).
- Folders are explorable: badge tells you how much is inside,
  clicking expands/collapses, defaults are sensible.

**Non-Goals:**
- Don't change the API. The path-as-relative shape is fine — just
  derive the basename client-side via `name.split('/').pop()`.
- Don't add filter / sort / search. Single small widget; complex
  search lives elsewhere.
- Don't introduce a separate component file. The widget is small
  enough to stay inline; extracting a file is overhead for one
  consumer.
- Don't lazy-load child tree levels. The API already returns up to
  depth 3 in one call; that fits the current need.

## Decisions

**D1. Basename via `path.split('/').pop()`.** The API's `path` is
posix-shaped (the runtime is Linux-only per CLAUDE.md). The split-pop
idiom is cheap and readable.

**D2. Recursive count via local helper.** Add a tiny
`countDescendants(node)` function that recurses through `children`
and returns `files + dirs` (all levels, excluding the node itself).
Memoize per render via `useMemo` keyed on the file tree if perf
matters; for trees of dozens of nodes it doesn't.

**D3. Default expand state from threshold.** Compute the default
once at component mount (`recursive > 10` ⇒ collapsed). Store
explicit `expanded` state per dir in a `useState<Record<string,
boolean>>` keyed by the dir's `path`. Clicking the row toggles its
key. The first render uses the default for any key not present in
state.

**D4. Lucide icons:**
- `<File className="size-3.5">` for files
- `<Folder>` (closed) / `<FolderOpen>` (expanded)
- `<ChevronRight>` (closed) / `<ChevronDown>` (expanded) — placed
  before the folder icon, sized small (`size-3`)

**D5. Indent scale: `depth * 16` px.** Doubles the previous 8.
Matches roughly the width of a folder + chevron icon set, so a
child's text starts where its parent's chevron is, which reads as
"indented under" rather than "co-located".

**D6. Recursive count for the threshold AND the badge.** The user
asked for "how many subfiles/subfolders (recursive)" as the count
metric, and "more than 10 entries → default collapse". Using the
same number for both keeps the badge and the default state
self-consistent.

**D7. Click on the entire folder row toggles.** Larger hit target,
no separate chevron-only click region — same as VS Code's file
explorer. Files have no toggle (clicking does nothing for now;
opening a file is out of scope).

## Risks / Trade-offs

- [Risk] If a future version of the API returns absolute paths,
  basename extraction would still produce the right text but the
  expansion state's path key would change. → Mitigation: the spec
  scenario locks the basename rendering, not the key shape.
- [Risk] Many sibling folders all defaulting to collapsed could
  produce a screenful of folders that look empty. → Mitigation: the
  badge `(N)` makes the populated ones clear; clicking expands.

## Migration Plan

Code-only edit. Restart picks it up.

## Open Questions

None.
