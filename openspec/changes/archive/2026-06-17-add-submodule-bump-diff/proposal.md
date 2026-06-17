## Why

A main-repo commit that bumps a submodule's pinned SHA shows up in
the history dialog as "a file changed", but the file's content on
both sides is just `Subproject commit <sha>\n` — there's nothing
useful to diff. The same display problem appears for commits that
reshape directories in ways the `--name-status` view collapses
awkwardly.

The user actually wants to **review what changed inside the
submodule** between the two pinned SHAs — i.e. show
`git log + git diff` from inside the submodule for the range
`<oldPin>..<newPin>`. The verification mark stays on the main-repo
commit (the user is reviewing the act of bumping the submodule from
the main repo's perspective); the cross-pointer diff is purely a
viewing aid.

## What Changes

- **MODIFIED** core reader `readGitCommit`: switch from
  `git diff-tree -r --root --name-status -M <sha>` to
  `git diff-tree -r --root --raw -M <sha>` so we get mode bits.
  Each `GitFileEntry` for a submodule-pointer change gains a new
  `submoduleBump?: { fromSha, toSha }` field populated from the
  raw line's `<oldSha> <newSha>` columns when the mode pair is
  `160000 160000` (or transitions from / to gitlink mode).
- **MODIFIED** `/git-diff` endpoint: add a new `side=range` variant
  requiring `from=<sha>&to=<sha>` (both validated against the
  safe-ref regex). With `submodule=<name>` scoping it to a
  submodule's cwd, this fetches `<from>:<path>` vs `<to>:<path>` —
  exactly the existing `readGitFileContents` plumbing, just with
  two arbitrary refs instead of a parent+commit pair.
- **NEW** endpoint `GET /api/projects/:p/git-range?from=<sha>&to=
  <sha>&submodule=<name>` — returns the file list AND commit
  summaries for the range. Files come from
  `git diff-tree -r --root --raw -M <from>..<to>` inside the
  submodule's cwd; commits come from `git log --format=...
  <from>..<to>`.
- **MODIFIED** `<GitHistoryDialog />` commit-detail file rows:
  - When `entry.submoduleBump` is present AND the path matches a
    known submodule from `['submodules', project]`, render a
    `<SubmoduleBumpRow />` instead of the regular `<FileRow />`.
- **NEW** `apps/web/components/submodule-bump-row.tsx` —
  collapsible row whose header reads
  `▸ <submodule-name>  bumped <fromShort> → <toShort>  (N commits)`.
  Expand fetches `/git-range` and renders:
  - A small commits list (subject + author + relative time) for
    context (no per-commit drill-down in v1 — same scope decision
    we made for the history dialog itself).
  - A file list re-using the existing `<FileRow />` with `side=
    "range"` and `sha={fromSha}` / a new `to={toSha}` prop, OR a
    different shape — see design.md for the chosen plumbing.
- **MODIFIED** `<FileRow />`: accept a new optional
  `range?: { from: string; to: string }` prop. When present,
  `<FileRowBody />` queries with the `range` side: `fetchGitDiff(
  project, path, 'range', undefined, submodule)` plus the range
  endpoints' from/to as additional query params.
- **NO change** to commit-marks. The mark for a main-repo commit
  that bumps a submodule stays on the main-repo commit, exactly
  as today.

What's NOT changing:

- The commit-marks CSV schema. Marks remain keyed by `(sha,
  submodule)` where the submodule field is the SUBMODULE the
  user is reviewing — for a main-repo bump commit, `submodule =
  ''` (main) because the mark is on the main-repo commit.
- The history dialog's submodule selector. Switching to a
  submodule still browses that submodule's own commit graph; the
  new behaviour only kicks in INSIDE a main-repo commit's detail
  view when one of its file entries is a submodule pointer.
- Non-submodule "directory-modification" display oddities outside
  of submodule bumps. The reader now uses `--raw` so we have more
  metadata for future work, but rendering for plain
  directory-rename commits stays as-is in v1. If users hit
  follow-up display bugs, they're separate spec deltas.

## Capabilities

### New Capabilities

- `git-submodule-bump-diff`: detection of submodule-pointer
  changes in main-repo commits via the new `submoduleBump` field
  on `GitFileEntry`, the `/git-range` endpoint, and the
  `<SubmoduleBumpRow />` UI that lets users review the range
  diff inline.

### Modified Capabilities

- `git-status`: `readGitCommit` switches from `--name-status` to
  `--raw` parsing, and `GitFileEntry` gains the optional
  `submoduleBump` field.
- `git-diff-dialog`: `/git-diff` accepts a new `side=range`
  variant; the dialog's `<FileRow />` accepts an optional
  `range?: { from, to }` prop for this side.
- `git-history-dialog`: commit-detail rendering detects
  submodule-bump entries and routes them through the new row
  component.

## Impact

- **Code**:
  - touched core: `history.ts` (raw parser + bump detection),
    `files.ts` (route layer for new side)
  - new route: `git-range/route.ts` + tests
  - extended route: `git-diff/route.ts` for `side=range`
  - touched components: `file-row.tsx`, `git-history-dialog.tsx`
  - new component: `submodule-bump-row.tsx` + test
  - touched API client in `apps/web/lib/api.ts`
- **Dependencies**: zero new npm deps.
- **Disk format**: no on-disk schema changes.
- **Performance**: each submodule bump in a viewed commit costs
  one additional `/git-range` GET on expand (lazy). Inside the
  range fetch, one `git diff-tree --raw` + one `git log` per
  expansion. Bounded and small.
- **Security**: `from` and `to` are validated against the same
  safe-ref regex `/^[A-Za-z0-9_\-/.~^]+$/` ≤ 200 chars that
  existing endpoints already use. `submodule` continues to go
  through the `.gitmodules`-validation helper.
