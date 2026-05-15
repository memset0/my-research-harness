## Why

The git-status / history / commit-marks plumbing we've built so far
treats each project as a single git repo. Users routinely have a
**main repo plus submodules** (vendored libraries, theme repos,
documentation forks) — and right now the dashboard pretends the
submodules don't exist. The status dialog calls
`--ignore-submodules=all`, the history dialog only browses the main
repo's branches, and the commit-marks CSV can't distinguish "I
verified commit `abc1234` in the main repo" from "I verified commit
`abc1234` in `vendor/lib`".

This change brings submodules into all three surfaces:

- **Status dialog**: each submodule renders its own Staged /
  Unstaged / Untracked sections with the same `<FileRow />` +
  `<FileDiff />` machinery the main repo uses.
- **History dialog**: a submodule selector sits next to the branch
  selector. Switching submodule re-targets the branches list, the
  commit list, and per-commit diffs.
- **Commit-marks CSV**: gains a 5th column `submodule` recording
  which repo the mark belongs to. Main-repo entries leave the column
  empty (per request: "主仓库就不用记录这一条"). Legacy 4-column
  CSV files are read as all-main-repo entries; first write upgrades
  the file to 5 columns.

Submodule names come from `.gitmodules` (the `[submodule "<name>"]`
header), per the user's "submodule 的名字按照在 gitsubmodule 中记录
的为准" requirement.

## What Changes

- **NEW** core reader
  `packages/core/src/git/submodules.ts` →
  `readGitSubmodules(projectRoot)` returns
  `{ enabled, submodules: [{ name, path }] }` parsed from
  `.gitmodules`. Recursive / nested submodules are out of scope
  for v1 (top-level only).
- **NEW** endpoint `GET /api/projects/:p/submodules` — returns the
  resolved submodule list; identical auth + viewer-scope rules as
  the other git endpoints.
- **MODIFIED** endpoints `/git-status/files`, `/git-diff`,
  `/git-branches`, `/git-log`, `/git-commit` — each accepts an
  optional `submodule=<name>` query param. When present, the
  route resolves `<projectRoot>/<submodule.path>` as the cwd before
  invoking the existing reader. Missing → main repo (current
  behaviour, unchanged). Unknown submodule name → 400.
- **MODIFIED** `<GitDiffDialog />` — fetches `/submodules` on open,
  then renders the existing three sections for the MAIN repo PLUS
  an additional block per submodule (each with its own three
  sections). Each `<FileRow />` passes `submodule={...}` so the
  per-file diff fetch targets the right cwd.
- **MODIFIED** `<GitHistoryDialog />` — toolbar gains a submodule
  `<Select>` (default "main") to the LEFT of the branch
  `<Select>`. Switching submodule:
  - invalidates `['git-branches', project, submodule]`,
  - resets the selected branch + selected commit,
  - refetches the commit list scoped to the new submodule.
  Refresh button invalidates branches + log for the current
  submodule scope.
- **MODIFIED** commit-verification CSV — adds a 5th column
  `submodule`. Main-repo entries leave it empty; submodule entries
  record the `.gitmodules` name. Rows are sorted by
  `(submodule, sha)` so related entries cluster in the diff.
- **MODIFIED** commit-marks endpoints — return an array
  `marks: CommitMark[]` instead of `Record<sha, CommitMark>`
  (composite key didn't generalize cleanly to two-tuple). PUT /
  DELETE accept `?submodule=<name>` to scope the mutation.
- **MODIFIED** `<CommitMarkEditor />` + `<CommitMarkBadge />` — both
  thread the current `submodule` (from the history dialog's
  submodule selector) through to the API calls.

What's NOT changing:

- Nested / recursive submodules. The reader stops at the top level.
  A future change can extend to nested if users hit this.
- The pill in the project footer and sidebar still reflects the
  MAIN repo's state only — submodule counts don't roll into the
  badge. The dialog is the place to see submodule detail.
- Branches' polling cadence (`git_status.interval_ms`) — still
  reads only the main repo. Submodule polling can be a follow-up
  if interest emerges.

## Capabilities

### New Capabilities

- `git-submodules`: parsing `.gitmodules`, the
  `/api/projects/:p/submodules` endpoint, the `?submodule=<name>`
  scoping convention shared by all git endpoints, and the readers
  that resolve `<projectRoot>/<submodule.path>` as a cwd.

### Modified Capabilities

- `git-status`: `/git-status/files` accepts `submodule=<name>`.
- `git-diff-dialog`: `/git-diff` accepts `submodule=<name>`;
  `<GitDiffDialog />` renders submodule sections.
- `git-history-dialog`: `/git-branches`, `/git-log`, `/git-commit`
  each accept `submodule=<name>`; the dialog gains a submodule
  selector.
- `commit-verification`: CSV gains a 5th column; `CommitMark` gains
  an optional `submodule` field; endpoints accept `?submodule=
  <name>`; the response shape changes from `Record<sha, ...>` to
  `marks: CommitMark[]`.

## Impact

- **Code**:
  - new core module `packages/core/src/git/submodules.ts` + tests
  - touched core: `commit-marks.ts` (new column + sort order)
  - touched routes: 5 existing endpoints take a new optional query
    param; 1 new route
  - touched components: `git-diff-dialog.tsx`,
    `git-history-dialog.tsx`, `commit-mark-editor.tsx`,
    `commit-mark-badge.tsx`, `file-row.tsx`
  - touched API client in `apps/web/lib/api.ts`
- **Dependencies**: zero new npm deps.
- **Disk format**: commit-marks CSV gains a column. Reader
  back-compat for the 4-column legacy form.
- **Performance**: status dialog now fires `git status` once per
  repo (main + N submodules). Triggered on dialog open only (not
  polled), so cost is bounded and lazy. History dialog's
  per-submodule fetches reuse the same TanStack staleTime contract.
- **Security**: `?submodule=<name>` is validated against
  `readGitSubmodules` — only names that appear in `.gitmodules`
  are accepted. Path resolution uses `submodule.path` from the
  parsed config (never user-supplied paths).
