## Why

`add-git-diff-dialog` gave us a per-project working-tree diff view.
The natural next layer — and the one users keep flipping to a terminal
for — is **commit history**: "what did I commit yesterday?", "what
changed in `2c929fc`?". GitHub-style: a list of recent commits with
short SHA / subject / author / relative time, click a commit to see
its file changes.

The diff renderer we built for working-tree changes works unchanged
for commit-vs-parent diffs (`<sha>^` vs `<sha>`). We just need a new
dialog that presents the commit list and reuses `<FileDiff />` for
each file inside a selected commit.

User-facing fetch policy: this is opt-in, not polled. Open the
dialog → fetch once. A refresh button next to the branch selector
forces a re-fetch when the user `git commit`s in their terminal and
wants the dialog to catch up.

## What Changes

- **NEW** trigger #1 in the project footer: a small clock/history
  icon button beside the existing git-status pill. Click opens the
  history dialog.
- **NEW** trigger #2 inside `<GitDiffDialog />`: a "View history"
  link in the dialog's header area. Click closes the status dialog
  and opens the history dialog (one dialog open at a time).
- **NEW** `apps/web/components/git-history-dialog.tsx` —
  two-pane dialog (commit list on the left, selected-commit detail
  on the right) with the SAME container size as `<GitDiffDialog />`:
  `w-[min(90vw,1600px)] max-w-none sm:max-w-none max-h-[90vh]`.
- **NEW** branch selector + refresh button at the top of the dialog:
  - **Branch select** — shadcn `<Select>`, populated with the
    project's LOCAL branches. Default selection is the project's
    current HEAD branch (the `git symbolic-ref HEAD` value). Detached
    HEAD: the select shows `(detached @ <short-sha>)` as the
    current value but still lets the user pick any local branch.
  - **Refresh button** — sits to the right of the select. Click
    invalidates the TanStack `['git-log', project, branch]` query
    and refetches.
- **NEW** commit list (left pane): shows up to 100 most-recent
  commits on the selected branch. Each row: short SHA + first-line
  subject + author name + relative time (full datetime on hover via
  the existing `Timestamp` component if convenient, else native
  `title`). Click a row → fetches the commit's file list and selects
  it in the right pane.
- **NEW** commit detail pane (right): when a commit is selected,
  renders header (full SHA, author, date, full message) and a file
  list — same `FileRow` collapsible used by `<GitDiffDialog />`,
  reusing `<FileDiff />` for the per-file diff.
- **MODIFIED** `apps/web/components/file-diff.tsx` — unchanged in
  behaviour, just rendered from a new caller.
- **MODIFIED** `apps/web/components/git-diff-dialog.tsx` — adds the
  "View history" link in its header.
- **MODIFIED** `apps/web/components/project-footer.tsx` — adds the
  new icon-button trigger alongside the existing pill trigger.
- **NEW** core readers in `packages/core/src/git/history.ts`:
  - `readGitBranches(cwd, opts?)` — lists local branches via
    `git for-each-ref refs/heads --format=...` and resolves the
    current HEAD via `git symbolic-ref HEAD`.
  - `readGitLog(cwd, { ref, limit }, opts?)` — `git log <ref>
    --max-count=N --format=<NUL-delimited fields>` and parses into
    typed `GitCommitSummary[]`.
  - `readGitCommit(cwd, sha, opts?)` — combines `git show
    --format=... --no-patch <sha>` for metadata with `git
    diff-tree -r --name-status [--root] <sha>` for the file list,
    producing `GitCommitDetail`.
- **MODIFIED** core reader `readGitFileContents` (in
  `packages/core/src/git/files.ts`) — accepts ARBITRARY git refs
  (e.g. `'<sha>'`, `'<sha>^'`, `'HEAD~3'`, branch names), not just
  `'HEAD' | 'index' | 'working'`. Existing call sites continue to
  work; new commit-side callers pass `<sha>^` and `<sha>`. The
  binary detection + 1024 KB cap + path-safety logic are unchanged.
- **NEW** endpoints, all guarded by the existing project-resolution
  + viewer-scope rules:
  - `GET /api/projects/:project/git-branches` — local branches +
    current-HEAD info.
  - `GET /api/projects/:project/git-log?ref=<branch>&limit=<N>` —
    commit list.
  - `GET /api/projects/:project/git-commit?sha=<x>` — single
    commit's metadata + file list.
- **MODIFIED** `GET /api/projects/:project/git-diff` — gains a new
  `side` value `commit`, requiring an additional `sha` query
  parameter. When `side=commit&sha=<x>`, `oldRef='<sha>^'`,
  `newRef='<sha>'`. Root commit (no parent) falls back to
  `oldContent=''` exactly the same way the staged-add case
  already does.

What's NOT changing:

- No polling. The dialog fetches on open + on refresh-click + on
  branch change. The pill's existing polling endpoint is untouched.
- No SSE topic.
- No new npm dependencies. The relative-time formatting can use
  `Intl.RelativeTimeFormat` or a tiny helper.
- v1 lists LOCAL branches only. Remote / tag refs deferred.
- v1 shows the first 100 commits with no pagination — "Load more"
  is a follow-up if a user asks.

## Capabilities

### New Capabilities

- `git-history-dialog`: The history dialog UX (branch select +
  refresh + commit list + selected-commit detail pane), the two
  trigger surfaces (footer button + status-dialog "View history"
  link), the three new endpoints (`/git-branches`, `/git-log`,
  `/git-commit`), and the three new core readers (`readGitBranches`,
  `readGitLog`, `readGitCommit`).

### Modified Capabilities

- `git-diff-dialog`: extends `/git-diff` with `side=commit&sha=<x>`
  and broadens `readGitFileContents` to accept arbitrary git refs
  so commit-vs-parent diffs reuse the same plumbing as the
  working-tree diffs.

## Impact

- **Code**:
  - new core module `packages/core/src/git/history.ts` + tests
  - widened `readGitFileContents` signature + tests
  - new routes `apps/web/app/api/projects/[project]/git-branches/
    route.ts`, `…/git-log/route.ts`, `…/git-commit/route.ts` +
    tests
  - extended `…/git-diff/route.ts` (validate `side=commit` + `sha`)
    + test additions
  - new component `apps/web/components/git-history-dialog.tsx` +
    tests
  - touched components `git-diff-dialog.tsx`, `project-footer.tsx`
  - new API client functions in `apps/web/lib/api.ts`
- **Dependencies**: zero new npm deps.
- **System**: same `git` binary as before. No new system
  requirements.
- **Performance**: dialog payload bounded — 100 commit headers (a
  few KB) + at most one commit's file list at a time + lazy
  per-file diff (1024 KB cap each side).
- **Security**: same project-name → root resolution. `sha`
  parameter restricted to a safe-ref character class
  (`[A-Za-z0-9_\-/.~^]+`, max 200 chars) before being passed to
  `git show`.
