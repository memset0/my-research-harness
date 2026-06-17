## Context

The `add-git-submodule-support` change shipped a submodule selector
in the history dialog and made every endpoint
`?submodule=<name>`-scopable. What that change did NOT cover: when
the user is looking at a MAIN-REPO commit, and one of its file
entries is in fact a submodule pointer bump, the current dialog
renders it as a regular file with content
`Subproject commit <sha>\n` on each side. The user sees a one-line
"diff" and learns nothing about what actually changed.

The user's ask: in that situation, swap the rendering — show
**what changed inside the submodule** between the two pinned SHAs.
The verification mark stays on the main-repo commit; the cross-
pointer view is purely a review aid.

## Goals / Non-Goals

**Goals:**

- Detect submodule-pointer bumps in any main-repo commit and
  surface them in the commit-detail UI with a row variant that
  makes the bump visible at a glance (`old → new` plus commit
  count).
- Expand-to-review: clicking such a row shows the SUBMODULE's
  per-file changes for the `from..to` range, each file
  individually expandable into a unified diff.
- Reuse `<FileDiff />` unchanged — the underlying renderer
  doesn't care whether the two strings came from a single commit
  or a range.

**Non-Goals:**

- Commit-by-commit drill-down inside the bump's range. The
  range-aggregated file diff is enough for v1.
- Marking individual commits inside the submodule range. The
  user marks the main-repo commit (existing behaviour). The
  submodule's own commits in the range can still be marked
  separately via the regular history-dialog flow with the
  submodule selector set to that submodule.
- Fixing every "directory modification looks weird" edge case.
  The reader now uses `--raw` output which gives us mode bits
  for the future, but we only act on the `160000 → 160000` case
  in this change.

## Decisions

### D1. Detect bumps via `git diff-tree --raw`

The current `readGitCommit` calls
`git diff-tree -r --root --name-status -M <sha>`. That output omits
mode bits.

`--raw` instead emits one line per file:

```
:<oldMode> <newMode> <oldSha> <newSha> <status>\t<path>
```

For submodule pointer changes, the modes are `160000 160000` (or
`000000 160000` when adding the submodule, `160000 000000` when
removing). We extract `<oldSha>` and `<newSha>` directly from the
line.

Trade-off: the raw format is fractionally trickier to parse
(leading colon, status-code-as-last-token rather than first), but
it's the only output that gives mode bits without an extra
invocation per file.

### D2. `GitFileEntry.submoduleBump` optional field

```ts
interface GitFileEntry {
  path: string
  status: GitFileStatus
  origPath?: string
  /** When the file is a submodule pointer change, the from/to
   *  SHAs of the submodule itself (the bytes on the main repo's
   *  tree are `Subproject commit <sha>\n` on each side). */
  submoduleBump?: { fromSha: string; toSha: string }
}
```

When the new-mode is `160000` AND the old-mode is `160000` (or
either of the gitlink-add / gitlink-remove cases), we populate
this. Renderers can decide what to do with it.

For the v1 UI, we only act on the standard bump case (both modes
`160000`). Adds (`000000 160000`) and removes (`160000 000000`)
still render as the regular FileRow with the file's two contents
— in practice that's still `Subproject commit ...` on one side
and empty on the other, but adding a submodule is rare enough
that the v1 UX is acceptable. Future iteration can extend.

### D3. `/git-diff?side=range&from=&to=`

A new fourth value for the existing `side` query param. Required
extra params: `from=<sha>`, `to=<sha>`. Both validated against
the same safe-ref regex as `sha` for `side=commit`. Optional
`submodule=<name>` to scope to a submodule's cwd (typical case
for this change).

Internally the route resolves `oldRef = from`, `newRef = to`, and
delegates to `readGitFileContents` for each side — same plumbing
as `side=commit` since the reader already accepts arbitrary refs.

Why extend `/git-diff` rather than introduce a new endpoint:
keeps `<FileRow />`'s fetch shape uniform — same fetcher, more
discriminators in the query key. Less code on the client.

### D4. `GET /api/projects/:p/git-range`

For the OVERVIEW (the list of files + commits in the range), we
need a distinct endpoint that the bump row's "expand" handler
calls once. It returns:

```ts
type GitRangeResponse =
  | { enabled: false; reason: ... }
  | {
      enabled: true
      from: string
      to: string
      submodule: string  // empty for main repo
      commits: GitCommitSummary[]
      files: GitFileEntry[]
    }
```

Implementation: `git diff-tree -r --root --raw -M <from>..<to>`
for files; `git log --format=... <from>..<to>` for commits.
Both invoked inside the resolved cwd (submodule-scoped via the
existing helper).

Validation: `from` AND `to` against the safe-ref regex, both
required.

### D5. UI — `<SubmoduleBumpRow />`

Inside `<CommitDetailBody />`'s file list, before rendering each
`<FileRow />`, we check `entry.submoduleBump` AND look up the
project's submodule list to confirm the path matches a known
submodule. If yes, render `<SubmoduleBumpRow />` instead.

```tsx
<SubmoduleBumpRow
  project={project}
  submodule={submoduleEntry.name}
  fromSha={entry.submoduleBump.fromSha}
  toSha={entry.submoduleBump.toSha}
  path={entry.path}
/>
```

Behaviour:

- Header (always visible): a leading chevron, the submodule
  name, `<fromShort> → <toShort>`, "(N commits)" placeholder
  while loading, then resolved count.
- Click expands; on first expand, fires
  `useQuery(['git-range', project, submodule, from, to])`.
- Loaded view: a small commits list (subject + author + relative
  time), then a flat file list. Each file row is a regular
  `<FileRow />` with the new `range={{ from, to }}` prop AND the
  `submodule` already in scope so per-file diffs hit
  `?side=range&from=&to=&submodule=&path=...`.

Width / vertical layout matches the existing FileRow so rows
don't look out of place inside the commit detail.

### D6. `<FileRow />` `range` prop

Add an optional `range?: { from: string; to: string }` prop. When
present, the row's per-file diff query is keyed by
`['git-diff', project, path, 'range', from, to, submodule]` and
the fetcher invokes
`fetchGitDiff(project, path, 'range', undefined, submodule, {
from, to })` — or we adapt the fetcher signature; see D7.

### D7. `fetchGitDiff` signature

Current: `fetchGitDiff(project, path, side, sha?, submodule?)`.

New shape — keep the simple positional path for the common case,
add an options bag for the rare ones:

```ts
fetchGitDiff(
  project: string,
  path: string,
  side: GitDiffSide,
  opts?: { sha?: string; submodule?: string; from?: string; to?: string }
)
```

This is a breaking signature change for existing callers, so we
either:

A. Migrate all call sites to the bag.
B. Keep positional, add a 6th positional arg `range?: { from, to }`.

I'm taking **(A)** because the bag scales better and we now have
4 optional discriminators; positional gets confusing fast. All
existing call sites already pass `sha` and/or `submodule`
positionally, so the migration is mechanical.

## Risks / Trade-offs

- **[Submodule SHA pinned but submodule directory uninitialised]**
  → `git show <from>:<path>` inside the submodule cwd returns an
  error since the submodule's `.git` doesn't exist locally. The
  reader surfaces this as `enabled: false, reason: 'error' /
  'not-a-repo'`; the row body shows the placeholder. Acceptable.
- **[The submodule's local git has been pruned and doesn't
  contain `<from>` / `<to>` SHAs]** → fairly common for vendored
  libs where users haven't fetched all history. The range query
  returns `enabled: false, reason: 'error'` with a stderr-ish
  message. UX shows the error; user can `git fetch` in the
  submodule and re-open.
- **[Large submodule range with thousands of commits]** → we use
  `--raw -r` (not `-p` / `-z`) and `git log --format=...` —
  bounded output. Reasonable for typical bumps; if hit, we can
  add a limit later.
- **[The breaking signature change to `fetchGitDiff`]** — all
  callers live in this repo; the migration is mechanical and
  caught by typecheck. Test mocks need the new arg shape too.

## Migration Plan

Pure additive on disk; no schema migration. Lazy on the client:
existing dialog sessions continue to work; first re-render of a
commit detail picks up the new `entry.submoduleBump` field; first
expand of a bump row hits the new endpoints.

## Open Questions

- **Should we surface commits in the bump-row's expand section,
  or only files?** v1 ships both (commits as a small list, files
  as the main interactive list). Lightweight enough to keep
  both.
- **Should adds / removes of submodules also get the special
  row?** Not in v1; the `submoduleBump` field is only populated
  for the standard `160000 → 160000` bump case. Add / remove is
  rare and still renders as a regular file row with `Subproject
  commit <sha>` content, which is at least honest.
