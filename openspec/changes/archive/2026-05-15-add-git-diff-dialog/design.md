## Context

`add-git-status-display` shipped a footer git-pill with hover-tooltip
detail and a `useRuntimeConfig`-driven polling cadence. That feature
established three things this change builds on:

- `@memon/core`'s `readGitStatus(cwd)` already shells out to
  `git status --porcelain=v2` and parses branch + counts.
- `/api/projects/:project/git-status` returns those counts on a
  per-project polling endpoint guarded by config-driven throttle.
- `react-diff-viewer-continued@^4.2.2` is already on `apps/web`'s
  dependency tree (unused so far).

The next user-facing step — clicking the pill to see what actually
changed — needs file-grain data plus a diff UI. Both are non-trivial
enough to deserve focused design.

## Goals / Non-Goals

**Goals:**

- One click on the project-footer git-pill opens a dialog that
  surfaces, for the current project: branch summary + Staged /
  Unstaged / Untracked file lists, each file collapsed by default,
  each text file expandable into a diff view.
- The diff view is a single reusable component (`<FileDiff />`) that
  the upcoming commit-history change can mount unchanged.
- The split-vs-inline view toggle is persisted globally — set it
  once in one file's diff, every other diff (in this dialog or any
  future one) renders the same way, including across tabs.
- Strict 1024 KB cap and binary detection per file, server-side, so
  the dialog and the client diff component never have to think
  about pathological inputs.
- Zero new npm dependencies.

**Non-Goals:**

- Browsing commit history or comparing arbitrary commits — that's
  the explicit next change. This change SHOULD NOT design itself
  around a specific commit-history UX, but the `<FileDiff />` shape
  must be agnostic enough to support it.
- In-place editing of files (e.g. inline `Stage Hunk` / `Discard`
  actions). Read-only diff for v1.
- Showing the diff of files renamed, copied, or with executable-bit
  changes specially — treat as a regular modify case.
- Tracking diffs of files in unmerged / conflict state. Falls back
  to the `skipReason` placeholder ("file in conflict — resolve in
  terminal").

## Decisions

### D1. New `/git-status/files` endpoint, separate from the pill endpoint

The pill polls `/api/projects/:project/git-status` every
`git_status.interval_ms` (default 10s). Adding file lists to that
response would balloon the polling payload for no gain (the pill
doesn't need file paths).

**Chosen:** `GET /api/projects/:project/git-status/files`, fetched
lazily once when the dialog opens (TanStack query key `['git-status-
files', project]`, `staleTime: 2_000`). Same project-resolution +
viewer-scope rules as the existing endpoint; no server-side throttle
beyond what TanStack's `staleTime` provides.

The endpoint reuses the same `git status --porcelain=v2 --branch
--ignore-submodules=all` invocation as the pill — we just parse the
file lines too. Implementation: a new `readGitStatusFiles(cwd)` in
`@memon/core` that wraps the existing reader and surfaces the per-
entry status.

Response shape:

```ts
type GitStatusFiles =
  | { enabled: false; reason: ... }
  | {
      enabled: true
      branch: string | null
      detached: boolean
      sha: string
      upstream: string | null
      ahead: number
      behind: number
      staged: GitFileEntry[]
      unstaged: GitFileEntry[]
      untracked: GitFileEntry[]
    }

interface GitFileEntry {
  path: string                       // repo-relative
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' |
          'untracked' | 'conflict' | 'typechange'
  origPath?: string                  // present for renamed/copied
}
```

### D2. Separate `/git-diff` endpoint, lazy per file

Loading every diff up-front would mean reading N files × 1024 KB on
dialog open. Instead, fetch each file's diff on expand.

**Endpoint:** `GET /api/projects/:project/git-diff?path=<rel>&side=
<staged|unstaged|untracked>`.

`side` distinguishes the three pairs:

| side       | oldRef       | newRef        | source of new content                |
|------------|--------------|---------------|--------------------------------------|
| staged     | HEAD         | index         | `git show :<path>`                   |
| unstaged   | index        | working tree  | working tree file read               |
| untracked  | (empty)      | working tree  | working tree file read               |

Old content for `staged`/`unstaged` comes from `git show <ref>:<path>`;
working-tree content is read with `fs.readFile`. The 1024 KB cap is
applied to BOTH sides; if either fails, the whole response is the
skip-reason placeholder.

Response shape:

```ts
type GitDiffResponse =
  | {
      ok: true
      filename: string                    // display name (newPath || path)
      oldFilename?: string                // present for renamed
      status: GitFileEntry['status']
      oldContent: string | null           // null when no old side (e.g. untracked)
      newContent: string | null           // null for deleted-only diffs
    }
  | { ok: false; skipReason: 'too-large'; sizeBytes: number; maxBytes: number; side: 'old' | 'new' }
  | { ok: false; skipReason: 'binary' }
  | { ok: false; skipReason: 'conflict' }
  | { ok: false; error: { message: string } }
```

### D3. Binary detection and the 1024 KB cap

- **Cap:** `MAX_DIFF_BYTES = 1024 * 1024` (constant in
  `packages/core/src/git/files.ts`). Both sides MUST be below this
  threshold; either side over → `skipReason: 'too-large'` with the
  offending side reported.
- **Binary detection:** read up to 8 KB from each side first, scan
  for a `0x00` byte. Match → `skipReason: 'binary'`. (Git uses the
  same `8000`-byte heuristic.) For `git show <ref>:<path>` we read
  the full bytes (capped at 1024 KB) and check the same prefix.
- **Encoding:** if no null byte AND `Buffer.isUtf8` succeeds → treat
  as UTF-8 string. Otherwise `skipReason: 'binary'`.

Caps and binary detection live in `@memon/core` (`files.ts`) so any
future caller (CLI, other web routes) gets the same behaviour.

### D4. Path safety

The route handler accepts `?path=<rel>`. We:

1. Resolve `project.root` from `Config.projects` by name (existing
   path-safety pattern).
2. Reject `path` if it contains `\0` or if `path.resolve(project.
   root, path)` does not have `project.root` as a prefix (i.e., the
   resolved absolute path must stay within the project root).
3. For `git show <ref>:<path>`, pass the validated repo-relative
   path verbatim. `git show` itself rejects paths outside the
   working tree.

### D11. Dialog sizing + 50/50 split layout

The Dialog content sets `w-[min(90vw,1600px)] max-w-none
sm:max-w-none` so it reaches 1600px on wide screens (where wide
diffs are most helpful) and gracefully shrinks to 90% of the
viewport on narrow ones.

Trap encountered: shadcn's `<DialogContent />` ships with both
`max-w-[calc(100%-2rem)]` (base) AND `sm:max-w-sm` (≥640px).
Just adding `max-w-none` only neutralizes the base rule — the
`sm:` responsive rule still wins on every realistic desktop
viewport, capping the dialog at 24rem. We pass both `max-w-none`
AND `sm:max-w-none` to override the responsive variant.

In split mode, each side of the diff fills exactly 50% of the
available width. RDV's default flex layout lets columns grow to fit
content, so a 200-character line would push the dialog into
horizontal scroll. We instead pass a `styles` override:

- `diffContainer`: `width: 100%`, `tableLayout: 'fixed'` (forces
  equal-width columns regardless of content)
- `column` / `content` / `lineContent`: `width: 50%`, `minWidth: 0`
- `contentText`: `whiteSpace: 'pre-wrap'`, `wordBreak: 'break-word'`,
  `overflowWrap: 'anywhere'` so long lines wrap inside their column

The outer `<div data-slot="file-diff">` no longer sets
`overflow-auto`; vertical scrolling for long diffs is the dialog's
content-area responsibility.

### D5. Reusable `<FileDiff />` component

```tsx
<FileDiff
  filename={string}
  oldFilename={string | undefined}    // rename display
  status={GitFileEntry['status']}
  oldContent={string | null}
  newContent={string | null}
  skipReason={null | 'too-large' | 'binary' | 'conflict'}
  loading={boolean}
  errorMessage={string | null}
/>
```

- View mode (`split` / `inline`) is NOT a prop — it comes from
  `useDiffViewMode()`. Two parallel mounts of `<FileDiff />` always
  render in the same mode.
- For `skipReason` ≠ null, renders a single-line placeholder ("file
  too large — 1.4 MB / 1 MB cap" / "binary file" / "file in
  conflict").
- For `loading`, renders a thin skeleton matching the diff area
  height.
- For `errorMessage`, renders the message in `text-destructive`.
- Otherwise, mounts `react-diff-viewer-continued` with
  `oldValue` / `newValue` / `splitView: mode === 'split'`. Strip
  carriage returns and force LF in both inputs to avoid noise diffs.

### D6. `useDiffViewMode()` hook

```ts
type DiffViewMode = 'split' | 'inline'
function useDiffViewMode(): [DiffViewMode, (m: DiffViewMode) => void]
```

- Default: `'split'` (matches most users' first expectation; can
  re-evaluate if the user prefers `'inline'`).
- Storage key: `memon:diff-view:mode`.
- Setting fires a custom `memon:diff-view-mode-change` event on the
  `window` that all mounted instances subscribe to. Also fires a
  storage write that cross-tab listeners receive via the native
  `storage` event.
- The hook reads `localStorage` once at mount and caches; subsequent
  reads come from the hook's React state.
- SSR-safe: `typeof window === 'undefined'` → returns the default and
  never throws.

### D7. Dialog click integration on the footer

The footer pill currently uses `<TooltipTrigger asChild><span...>`.
We wrap that span in a `<button>` that opens the dialog on click.
Hover still triggers the tooltip; click triggers the dialog —
standard radix behaviour, the two don't conflict because Radix's
Tooltip uses pointer events on a non-button child and Dialog uses
the button's `onClick`.

The sidebar's compact pill is NOT made clickable in v1: its parent
row already toggles a `Collapsible`, so adding another click target
inside would create a conflict UX. Users can click the footer pill
on any project page to access the dialog.

### D8. Dialog file-list rendering

- Section components: `Staged (N)`, `Unstaged (N)`, `Untracked (N)`.
  Sections themselves are NOT collapsible (always visible) — this
  matches the user request that "every file is collapsed by default"
  applies at the file row, not section, level.
- Empty sections still render with the heading + "(none)" so the
  user can confirm "nothing staged" at a glance.
- File row: status icon + path (monospace) + chevron. Click to
  expand → mounts `<FileDiff />` with a fetched payload (or
  `loading` while in flight).
- Untracked file rows: side=untracked, old=null, new=content; the
  diff appears as all-additions.
- Renamed file rows: display as `oldPath → newPath` in the row
  header; diff fetched as the new path side.

### D9. SSE / live updates

Out of scope for this change. The dialog re-fetches on open; users
can close + re-open to refresh. A future change can wire SSE or a
short refetchInterval if interactive use shows that's needed.

## Risks / Trade-offs

- **[Large modified file]** → 1024 KB cap; user sees the placeholder
  with the actual file size. Same path for both staged + unstaged.
- **[Path that looks valid but escapes root via symlink]** → guarded
  by the resolve-and-prefix-compare check (D4). A symlink whose
  target is outside the repo would still be read by `fs.readFile`,
  but `git show :<path>` will only ever return the index blob, and
  the resolve-compare gate runs first.
- **[react-diff-viewer-continued performance with 1 MB inputs]** →
  the library is happy with large strings but layout can lag on
  pathological all-add diffs. Acceptable for v1; user can collapse
  the file.
- **[Cross-tab toggle sync race]** → if the user toggles split in
  tab A while tab B is mid-render, React may render once with the
  old mode before re-rendering with the new. Cosmetic, not a
  correctness issue.
- **[Renamed/copied files]** → status code `R` (`2 R..` line in
  porcelain v2). Display the original path as `oldPath` and treat
  the diff as a regular modification of `newPath`. Detection of
  100% pure renames vs renamed-with-edits is reflected by the diff
  itself.

## Migration Plan

Pure additive. No spec deletions, no config migration. Existing
`/git-status` endpoint, throttle, polling cadence remain
byte-identical.

- Deploy → footer pill becomes clickable; first click opens dialog.
- Rollback → revert the change set; no on-disk artifacts to clean.

## Open Questions

- **Default view mode** — split or inline? Picking split because
  the user said "左右对比" first in their description; the toggle
  remembers preference.
- **Untracked file size cap** — apply the 1024 KB cap to untracked
  too? Yes for v1; user can `git add` the file and the dialog will
  show it as a staged "added" entry with the same cap. If we ever
  want a "view untracked file" path without the cap we can revisit.
- **Conflicts** — render in the dialog but with `skipReason:
  'conflict'`? Yes; the file shows up under Unstaged (since git
  classifies it as unstaged on the worktree side) and the row
  expands to a placeholder pointing to the terminal.
