## Context

The `add-git-diff-dialog` change established the foundations we
reuse here:

- `<FileDiff />` — stateless per-file diff renderer wrapping
  `react-diff-viewer-continued`, view-mode-aware via
  `useDiffViewMode()`.
- `readGitFileContents(cwd, ref, path)` — single entry point for
  "give me the bytes at this side, with cap + binary detection".
- `<GitDiffDialog />` — dialog shell with the 1600px-wide content
  and three collapsible sections of FileRows.

The next step is browsing commit history. Conceptually it's the
same dialog pattern, but instead of "three sections of working-tree
sides" the left pane is a SCROLLABLE LIST of commits and the right
pane is "one commit's file changes". Per-file rendering reuses
`<FileDiff />` unchanged.

The user wants two ways in: a footer icon button (discoverable from
any project page) AND a "View history" link inside the existing
diff dialog (for users who came in via the status flow).

## Goals / Non-Goals

**Goals:**

- A single dialog that lists the project's commits (default: current
  branch) and lets the user drill into any commit's per-file diffs.
- Reuse `<FileDiff />` unchanged for per-file rendering — including
  the global split/inline view-mode preference.
- Two triggers: footer icon button + link inside the existing
  git-status dialog. Only ONE dialog open at a time (clicking the
  link inside git-status closes that dialog and opens history).
- Branch selector at the top of the dialog, defaulting to the
  current HEAD branch. Refresh button immediately to the right of
  the select.
- Zero new npm dependencies.

**Non-Goals:**

- Remote / tag ref browsing — v1 shows local branches only.
- Pagination of the commit list — v1 fetches a fixed 100, no
  "Load more". (Easy follow-up if users hit the cap.)
- Searching / filtering commits by author / message — deferred.
- Showing commit comparisons (range diffs) — deferred.
- Editing / cherry-picking / reverting — read-only.

## Decisions

### D1. Reuse `/git-diff` with `side=commit&sha=<x>`

Alternatives considered: new `/git-commit-diff?sha=&path=` endpoint.

**Chosen:** extend the existing endpoint. Adding a `side=commit`
value with a required `sha` query param keeps the FileRowBody
component's fetch call uniform across the working-tree dialog and
the history dialog — both pass `(project, path, side, sha?)` and
the route picks the right pair of refs:

| side       | oldRef      | newRef       |
|------------|-------------|--------------|
| staged     | HEAD        | index        |
| unstaged   | index       | working      |
| untracked  | (empty)     | working      |
| commit     | `<sha>^`    | `<sha>`      |

The `<sha>^` lookup naturally returns `not-found` for the root
commit; the route already handles that case by falling back to
`oldContent: ''` (same path as the staged-add case).

### D2. Widen `readGitFileContents` to accept arbitrary refs

Currently `ref: 'HEAD' | 'index' | 'working'`. We change it to
`ref: 'index' | 'working' | string` — anything that isn't one of
the two literals is passed straight through as a git rev to
`git show <ref>:<path>`. `'HEAD'` keeps working unchanged. New
callers pass `'<sha>'`, `'<sha>^'`, branch names, etc.

`sha` is validated at the route layer (D6) BEFORE reaching the
core reader, so the core function trusts its caller.

### D3. New core readers in `packages/core/src/git/history.ts`

Three readers, all returning discriminated unions with `enabled:
false` for non-repos / git-not-found / timeout, mirroring the
existing `readGitStatus*` shape:

- `readGitBranches(cwd)` →
  `{ enabled: true; current: string | null; detached: boolean;
    sha: string; branches: GitBranchEntry[] }`.
  Uses `git for-each-ref refs/heads --format='%(refname:short)
  %(objectname:short) %(HEAD)'` and `git symbolic-ref --short -q
  HEAD` (which exits non-zero on detached HEAD).

- `readGitLog(cwd, { ref, limit })` →
  `{ enabled: true; commits: GitCommitSummary[] }`.
  Uses `git log <ref> --max-count=<limit> --format=...` with NUL
  field separators and a record separator (RS, `\x1e`) between
  commits so subjects / bodies containing newlines parse cleanly.

- `readGitCommit(cwd, sha)` →
  `{ enabled: true; ...metadata...; files: GitFileEntry[] }`.
  Uses `git show --format=... --no-patch <sha>` for metadata and
  `git diff-tree -r --root --name-status <sha>` for the file list.
  `--root` ensures the root commit (no parent) reports its initial
  files as `A`.

### D4. New endpoints, all lazy

| Endpoint | Triggered by |
|----------|--------------|
| `GET /api/projects/:p/git-branches` | dialog open (also on refresh) |
| `GET /api/projects/:p/git-log?ref=&limit=` | dialog open + branch change + refresh |
| `GET /api/projects/:p/git-commit?sha=` | commit row click |
| `GET /api/projects/:p/git-diff?path=&side=commit&sha=` | file row expand |

None of these poll. None throttle server-side (TanStack `staleTime`
covers in-tab dedupe).

### D5. Dialog layout — two-pane

```
┌───────────────────────────────────────────────────────────────────┐
│ project-name — history                                       [✕] │
├───────────────────────────────────────────────────────────────────┤
│  [Branch: main ▾]  [↻ Refresh]              [split | inline]      │
├──────────────────────────┬────────────────────────────────────────┤
│  COMMIT LIST (35%)       │  SELECTED COMMIT (65%)                 │
│  scrollable              │  scrollable                            │
│                          │                                        │
│  abc1234 fix bug         │  commit abc1234567890abcdef            │
│  Hao  2h ago             │  Author: Hao <h@example.com>           │
│  ─────────────────────   │  Date:   2026-05-13 14:32:00 +08:00    │
│  def5678 add feature    │                                         │
│  Hao  4h ago             │  fix the bug that ate my homework      │
│  ─────────────────────   │                                         │
│  ...                     │  Files (3)                              │
│                          │  ▸ M  app/page.tsx                      │
│                          │  ▸ A  lib/new-helper.ts                 │
│                          │  ▸ D  legacy/old.ts                     │
└──────────────────────────┴────────────────────────────────────────┘
```

- Left pane: `ul` of commit rows, fixed-width column on the left
  (~35% of container width). On mobile (`<sm:`) the pane collapses
  to full-width with a "back to commit list" button when a commit
  is selected.
- Right pane: empty placeholder until a commit is clicked; then
  metadata header + reused `<FileRow />` list from `git-diff-
  dialog.tsx` (extracted into a shared module so both dialogs
  use it).
- View-mode toggle (split / inline) lives in the right pane's
  toolbar OR the top-right of the dialog header — implementer's
  choice as long as it uses the existing `useDiffViewMode()` hook.

### D6. Branch selector + refresh

- Branch list comes from `/git-branches`. The select shows
  `[branch] [is-current ★]` for each entry. Default selection
  is the current HEAD branch; if HEAD is detached, the default
  is the `(detached @ <short-sha>)` synthetic entry — selecting
  it makes the log fetch use the actual SHA as the ref.
- Refresh button uses `QueryClient.invalidateQueries({ queryKey:
  ['git-log', project, ref] })` to force a re-fetch. It also
  invalidates `['git-branches', project]` so a newly-created
  branch shows up in the select.
- Refresh does NOT invalidate per-commit queries (`['git-commit',
  project, sha]` and `['git-diff', project, path, side, sha]`) —
  those are immutable once committed.

### D7. `sha` parameter validation

The route accepts `sha` as a query parameter. To prevent shell-
metacharacter or directory-traversal abuse before passing it to
`git show <ref>:<path>`, the route validates:

- non-empty
- length ≤ 200 (a SHA-1 is 40 chars; allow room for `HEAD~3` etc.
  if a future client wants symbolic refs)
- matches `/^[A-Za-z0-9_\-/.~^]+$/`

Anything failing → 400.

### D8. Trigger #2 — link in git-diff-dialog

The status dialog's header gains a "View history" link / small
button. Clicking it:

1. Closes the status dialog (`onOpenChange(false)`).
2. Calls a parent-provided callback `onOpenHistory()` which sets
   the parent's history-dialog `open=true`.

Both dialogs share the same parent (`<ProjectFooter />`) so the
parent owns the two booleans and toggles them mutually. Only one
is open at any time.

### D9. Trigger #1 — footer icon button

A small `<button>` with a clock / history icon (lucide `History`)
sits in `<ProjectFooter />` to the right of the existing git-pill
trigger button, separated by a thin divider. Same accent-on-hover
treatment.

When git is disabled for the project (the pill returns null), the
history button ALSO returns null — opening a history dialog for a
non-git project would just show "not a git repository".

### D10. Reusing `<FileRow />` between dialogs

`<FileRow />` and `<FileRowBody />` from `git-diff-dialog.tsx`
become exported from a shared module `apps/web/components/file-
row.tsx` (move). Both dialogs import them.

The row's behaviour is unchanged: collapsed by default, lazy
fetch on expand, query stays mounted after collapse so re-expand
hits the cache.

The row needs one new pluggable detail: the diff query is keyed by
`(project, path, side, sha?)` and the fetcher needs the optional
`sha`. We extend `FileRow` to accept `side: 'staged' | 'unstaged'
| 'untracked' | 'commit'` AND an optional `sha: string`. The
existing call sites (in `git-diff-dialog.tsx`) pass `sha:
undefined` and the row defaults to the commit-less path; the new
history dialog passes `sha: <selected-commit-sha>`.

## Risks / Trade-offs

- **[Large commit with many files]** → bounded by per-file 1024 KB
  cap and lazy fetch on expand. No upper bound on file COUNT in v1;
  if a commit modifies 500 files, the file-row list is long but
  paint is fine (rows are HTML, no diff body until expand).
- **[Long commit subject overflows the list row]** → CSS truncate
  with title-tooltip.
- **[Branch with thousands of commits]** → v1 cap of 100 covers
  typical research-project history. The dialog notes "showing 100
  most recent" implicitly via the cap; if users hit it, "Load
  more" is a follow-up.
- **[Detached HEAD]** → the branch select displays a synthetic
  `(detached @ <short-sha>)` entry which is the default selection.
  Switching to a real branch sets ref to the branch name; switching
  back to detached selects the SHA. Reload-friendly because the
  state lives in URL? Actually for v1 it's only in component state
  — the dialog state isn't URL-encoded.
- **[Renamed file in commit]** → `diff-tree --name-status` produces
  `R100\told\tnew`. Same parsing as the existing porcelain v2 type-2
  line. Display `old → new`.
- **[Root commit]** → `<sha>^` is invalid; `readGitFileContents`
  returns `not-found`; the diff route falls through to
  `oldContent: ''`, status='added' — already the behaviour for
  staged-add. Same code path.

## Migration Plan

Pure additive. No on-disk migration. Existing dialog + endpoints
remain byte-identical.

## Open Questions

- **Where exactly does the view-mode toggle live in the history
  dialog?** Suggested: top-right of the right pane's header. Easy
  to revisit during apply.
- **Relative time formatting**: use `Intl.RelativeTimeFormat` for
  i18n correctness, or a tiny `formatRelative(date)` helper? Lean
  toward a helper — the dashboard's other surfaces don't currently
  use `Intl.RelativeTimeFormat`, and consistency wins.
- **Should the dialog persist the last-selected branch across
  open/close?** v1 says no — every open defaults to current HEAD.
  Can add `localStorage[memon:history-dialog:branch]` later if
  users want it.
