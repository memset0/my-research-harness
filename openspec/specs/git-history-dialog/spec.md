# git-history-dialog Specification

## Purpose
Describes the read-only dashboard dialog for browsing a project's git history: branch and submodule selection, a commit list, and a selected-commit detail pane with file diffs and submodule bump rows. It is backed by the `readGitBranches`, `readGitLog` and `readGitCommit` readers in `@memon/core` (`git/`) and their `/api/projects/:project/git-*` endpoints, with the UI in `apps/web`. The commit-mark badge and editor shown in the dialog follow the deprecated `commit-verification` capability; Wiki review is specified separately.

## Requirements
### Requirement: Two trigger surfaces open the history dialog

The history dialog SHALL be reachable from two places:

1. **Footer icon button** — a `<button>` with `data-slot="git-
   history-dialog-trigger"` sits in `<ProjectFooter />` to the
   right of the existing git-status pill trigger, using a clock /
   history icon (lucide `History`). Click opens the history
   dialog. When the git-status query reports `enabled: false` for
   the project, the button MUST NOT render.
2. **"View history" link in `<GitDiffDialog />`** — the status
   dialog's header gains a `data-slot="git-diff-dialog-history-
   link"` element. Click closes the status dialog AND opens the
   history dialog. Both dialogs MUST NOT be open simultaneously —
   the implementation routes both open-states through a common
   parent so opening one closes the other.

#### Scenario: Footer button opens the history dialog
- **GIVEN** the user is on `/p/project-a` and the git pill is
  visible
- **WHEN** the user clicks the `data-slot="git-history-dialog-
  trigger"` element
- **THEN** a dialog with `data-slot="git-history-dialog"` opens

#### Scenario: Footer button suppressed for non-git project
- **GIVEN** the git query for the project resolves with
  `enabled: false`
- **WHEN** the footer renders
- **THEN** no `data-slot="git-history-dialog-trigger"` element is
  present in the DOM

#### Scenario: "View history" link from status dialog
- **GIVEN** `<GitDiffDialog />` is open on `/p/project-a`
- **WHEN** the user clicks the `data-slot="git-diff-dialog-
  history-link"` element
- **THEN** the status dialog closes AND the history dialog opens
  in its place; at no point are both dialogs open simultaneously

### Requirement: `<GitHistoryDialog />` content structure and sizing

`apps/web/components/git-history-dialog.tsx` SHALL export a client
component mounted as a shadcn Dialog whose `DialogContent` SHALL
use the SAME width and height container as `<GitDiffDialog />`:
classes `w-[min(90vw,1600px)] max-w-none sm:max-w-none max-h-
[90vh]` (both `max-w-none` variants required — see
`git-diff-dialog` spec).

The dialog body SHALL be a two-pane layout on viewports `≥ sm`:

- **Left pane** (≈ 35% of the container width): scrollable list of
  commit rows.
- **Right pane** (≈ 65%): when a commit is selected, renders that
  commit's metadata header + a list of `FileRow` instances (same
  collapsible widget used by `<GitDiffDialog />`). Each `FileRow`
  expands to mount `<FileDiff />` using the existing reusable
  component.

On viewports `< sm` the dialog collapses to a single column: the
commit list fills the body, clicking a commit replaces the body
with the selected-commit detail, and a "Back to commits" affordance
returns the user to the list.

#### Scenario: Dialog has the same shell dimensions as the status dialog
- **WHEN** the history dialog renders
- **THEN** `DialogContent` has Tailwind classes
  `w-[min(90vw,1600px)]`, `max-w-none`, `sm:max-w-none`, and a
  `max-h-[90vh]`

#### Scenario: Two-pane layout on desktop
- **GIVEN** the dialog renders on a `≥ sm` viewport
- **WHEN** the body renders
- **THEN** the markup contains a commit-list region with
  `data-slot="commit-list"` AND a detail region with
  `data-slot="commit-detail"`

#### Scenario: Right pane is empty until a commit is selected
- **GIVEN** the dialog has just opened and no commit has been
  clicked
- **WHEN** the body renders
- **THEN** the `data-slot="commit-detail"` region contains a
  placeholder ("Select a commit to view its changes" or similar)
  and NO `<FileRow />` instances

### Requirement: Branch selector + refresh button

The dialog header SHALL contain a shadcn `<Select>` populated with
the project's LOCAL branches plus, when applicable, a synthetic
`(detached @ <short-sha>)` entry. The default selection SHALL be
the current HEAD branch (or the synthetic detached entry when HEAD
is detached).

To the right of the select sits a refresh `<Button>` with
`data-slot="git-history-refresh"`. Click SHALL invalidate BOTH
the `['git-log', project, ref]` query AND the `['git-branches',
project]` query so a freshly-created branch or commit shows up
immediately.

The refresh button SHALL NOT invalidate per-commit queries
(`['git-commit', project, sha]`) or per-file diff queries
(`['git-diff', project, path, side, sha]`) — commit content is
immutable once committed and re-fetching it is wasted work.

#### Scenario: Default selection is current branch
- **GIVEN** the project's current HEAD is branch `main`
- **WHEN** the dialog opens
- **THEN** the branch select's current value is `main`

#### Scenario: Default selection on detached HEAD
- **GIVEN** the project's HEAD is detached at SHA `abc1234`
- **WHEN** the dialog opens
- **THEN** the select includes a `(detached @ abc1234)` entry and
  selects it by default

#### Scenario: Refresh invalidates branch + log queries
- **GIVEN** the dialog is open and the commit list has rendered
- **WHEN** the user clicks the `data-slot="git-history-refresh"`
  button
- **THEN** the next render fires fresh GETs to
  `/api/projects/:p/git-log?ref=...` AND `/api/projects/:p/git-
  branches` — but does NOT fire `/api/projects/:p/git-commit?...`
  or `/api/projects/:p/git-diff?...` requests for already-cached
  commits

#### Scenario: Switching branch refetches the log
- **GIVEN** the dialog has loaded commits for `main`
- **WHEN** the user selects `feature/x` in the branch select
- **THEN** a fresh GET to `/api/projects/:p/git-log?ref=feature/x
  &limit=100` is fired

### Requirement: Commit list rendering

The commit list (left pane) SHALL render up to `limit=100`
commits from `GET /api/projects/:p/git-log?ref=<ref>&limit=100`.
Each row SHALL display:

- short SHA (7 chars) in monospace
- the commit's subject line, truncated to one line with CSS
  ellipsis
- author name (without email)
- relative time (e.g. "2h ago", "yesterday", "3 weeks ago"); the
  full timestamp SHALL be exposed via the `title` attribute for
  on-hover detail

While the log query is pending, the list SHALL show shadcn
skeletons. On error, a short retry-able error message replaces
the list.

Clicking a commit row SHALL select it: the row gains a
`data-selected="true"` attribute AND the right pane fetches and
renders that commit's detail.

#### Scenario: List renders up to 100 commits
- **GIVEN** the project has 500 commits on `main`
- **WHEN** the dialog opens with ref=main
- **THEN** exactly 100 rows render and the log endpoint was called
  with `limit=100`

#### Scenario: Clicking a row selects it
- **GIVEN** the commit list has rendered
- **WHEN** the user clicks the third row
- **THEN** that row has `data-selected="true"` and a fresh GET to
  `/api/projects/:p/git-commit?sha=<that-row's-sha>` is fired

#### Scenario: Subject truncation
- **GIVEN** a commit whose subject is 200 characters long
- **WHEN** its row renders
- **THEN** the row uses CSS `truncate` (or equivalent overflow:
  ellipsis behaviour) and stays on a single line

### Requirement: Selected-commit detail pane

When a commit is selected, the right pane SHALL render:

1. Header: full SHA in monospace, author name + email, full ISO
   datetime, full commit message (subject + body).
2. File list: a `<FileRow />` per file in
   `commit.files`, collapsed by default, reusing the existing
   component. Each row, on expand, fetches
   `/api/projects/:p/git-diff?path=<path>&side=commit&sha=<sha>`
   and renders the result via `<FileDiff />`.

While the `git-commit` query is pending, the pane SHALL show a
skeleton placeholder.

#### Scenario: Detail pane shows the commit header + files
- **GIVEN** the user has clicked a commit with SHA `abc1234` whose
  detail resolves to 3 file changes
- **WHEN** the detail pane renders
- **THEN** the pane displays the full SHA, author, datetime, and
  full message AND renders 3 `FileRow` instances

#### Scenario: Expanding a file row fires a commit-side diff request
- **GIVEN** the detail pane has rendered with 3 files
- **WHEN** the user clicks the first file row to expand it
- **THEN** a GET to
  `/api/projects/:p/git-diff?path=<path>&side=commit&sha=<sha>`
  is fired, the response is rendered via `<FileDiff />`, and the
  rendered diff shares the same `useDiffViewMode()` mode as any
  other mounted `<FileDiff />` in the app

### Requirement: `readGitBranches` core reader

`@memon/core` SHALL export
`readGitBranches(cwd: string, opts?: { timeoutMs?: number; gitBin?: string }):
Promise<GitBranches>` from `packages/core/src/git/history.ts`,
where `GitBranches` is the discriminated union:

```ts
type GitBranches =
  | { enabled: false; reason: 'not-a-repo' | 'git-not-found' | 'timeout' | 'error'; message?: string }
  | {
      enabled: true
      current: string | null         // null when detached
      detached: boolean
      sha: string                    // short SHA of HEAD
      branches: GitBranchEntry[]     // local branches only (refs/heads)
    }

interface GitBranchEntry {
  name: string
  sha: string                        // short SHA
  isCurrent: boolean
}
```

Implementation SHALL use:

- `git for-each-ref refs/heads --format='%(refname:short)%00%(objectname:short)%00%(HEAD)'`
  for the branch list (NUL-delimited fields; `%(HEAD)` resolves to
  `*` for the current branch and ` ` otherwise)
- `git rev-parse --short HEAD` for HEAD's SHA
- `git symbolic-ref --short -q HEAD` for the current branch name;
  non-zero exit means detached HEAD

Error classification matches the existing `readGitStatus*` readers
(`'not-a-repo'`, `'git-not-found'`, `'timeout'`, `'error'`).

#### Scenario: Repo with two local branches
- **GIVEN** the repo has branches `main` (current) and `feature/x`
- **WHEN** `readGitBranches(cwd)` runs
- **THEN** the resolved value has `current: 'main'`, `detached:
  false`, AND `branches` contains entries for both `main` (with
  `isCurrent: true`) and `feature/x` (`isCurrent: false`)

#### Scenario: Detached HEAD
- **GIVEN** the repo's HEAD is checked out detached at SHA
  `abc1234`
- **WHEN** `readGitBranches(cwd)` runs
- **THEN** the resolved value has `current: null`, `detached:
  true`, `sha: 'abc1234'`, and `branches` is the unchanged local-
  branch list (none flagged `isCurrent`)

### Requirement: `readGitLog` core reader

`@memon/core` SHALL export
`readGitLog(cwd: string, options: { ref: string; limit: number },
opts?: { timeoutMs?: number; gitBin?: string }):
Promise<GitLog>`.

```ts
type GitLog =
  | { enabled: false; reason: 'not-a-repo' | 'git-not-found' | 'timeout' | 'error'; message?: string }
  | { enabled: true; commits: GitCommitSummary[] }

interface GitCommitSummary {
  sha: string                        // full 40-char SHA
  shortSha: string                   // 7 chars
  subject: string                    // first line of message
  authorName: string
  authorEmail: string
  authorDate: string                 // ISO 8601 with offset (e.g. 2026-05-13T14:32:00+08:00)
  parents: string[]                  // full SHAs
}
```

Implementation SHALL invoke
`git log <ref> --max-count=<limit> --format=<spec>`
where `<spec>` uses NUL field separators inside each commit and a
record separator (RS, `\x1e`) between commits so commit subjects
and bodies never collide with the field/record delimiters.

`ref` is passed to git verbatim — the route layer (D7) validates
it BEFORE invoking the reader.

#### Scenario: Returns commits in newest-first order
- **GIVEN** a repo with commits A → B → C on `main` (C newest)
- **WHEN** `readGitLog(cwd, { ref: 'main', limit: 100 })` runs
- **THEN** `commits[0].sha === C` and `commits[2].sha === A`

#### Scenario: Caps at limit
- **GIVEN** a repo with 500 commits on `main`
- **WHEN** `readGitLog(cwd, { ref: 'main', limit: 100 })` runs
- **THEN** `commits.length === 100`

#### Scenario: Unknown ref
- **GIVEN** `ref` is a branch that doesn't exist
- **WHEN** the reader runs
- **THEN** the resolved value is
  `{ enabled: false, reason: 'error', message: '...' }`

### Requirement: `readGitCommit` core reader

`@memon/core`'s `readGitCommit(cwd, sha, opts?)` SHALL continue
to return the existing `GitCommitDetail` discriminated union,
with one extension: the `files` array's entries MAY carry an
optional `submoduleBump?: { fromSha: string; toSha: string }`
field for entries that represent submodule pointer changes.

Implementation change: the file list is now sourced from
`git diff-tree -r --root --raw -M <sha>` (rather than
`--name-status`). The raw output line format is:

```
:<oldMode> <newMode> <oldSha> <newSha> <status>\t<path>
```

with rename / copy entries adding a `\t<origPath>` segment. The
parser:

- Extracts `path` (and `origPath` for `R`/`C` entries) exactly
  as before.
- Maps the status code to the existing `GitFileStatus` enum.
- When BOTH `oldMode` AND `newMode` are `160000` (the gitlink
  mode), populates
  `submoduleBump = { fromSha: <oldSha>, toSha: <newSha> }`.
- For non-gitlink entries, `submoduleBump` is absent
  (`undefined`).

Returned shape (unchanged outer envelope; only `files[]` entries
gain the optional field):

```ts
export interface GitFileEntry {
  path: string
  status: GitFileStatus
  origPath?: string
  submoduleBump?: { fromSha: string; toSha: string }
}
```

#### Scenario: Commit bumping a submodule pointer
- **GIVEN** a commit whose `git diff-tree --raw` output contains
  `:160000 160000 aaa1111 bbb2222 M\tvendor/foo`
- **WHEN** `readGitCommit(cwd, sha)` runs
- **THEN** the resolved `files` array contains
  `{ path: 'vendor/foo', status: 'modified', submoduleBump:
  { fromSha: 'aaa1111', toSha: 'bbb2222' } }`

#### Scenario: Regular file modification carries no submoduleBump
- **GIVEN** a commit whose `git diff-tree --raw` output contains
  `:100644 100644 1111111 2222222 M\tapp.ts`
- **WHEN** the reader runs
- **THEN** the corresponding entry has `submoduleBump`
  undefined / absent

#### Scenario: Renamed file still parses status + origPath
- **GIVEN** a rename `R100\told\tnew` in raw form
- **WHEN** the reader runs
- **THEN** the entry has `status: 'renamed'`, `path: 'new'`,
  `origPath: 'old'`, and no `submoduleBump`

### Requirement: `GET /api/projects/:project/git-branches` endpoint

The web server SHALL expose
`GET /api/projects/:project/git-branches`. Behaviour:

- Project resolution + viewer scope match the existing
  `/git-status` route (404 on unknown project, 403 on viewer
  out-of-scope).
- Calls `readGitBranches(project.root)` and returns the
  discriminated-union value as the response body with HTTP 200.
- No server-side cache. No throttle.

#### Scenario: Owner GET returns branches + current
- **WHEN** an owner requests `GET /api/projects/<p>/git-branches`
- **THEN** the response is `200 { enabled: true, current: '<...>',
  detached: false, sha: '<short>', branches: [...] }`

#### Scenario: Unknown project
- **WHEN** the project name does not resolve
- **THEN** the response is `404`

#### Scenario: Viewer out-of-scope
- **WHEN** a viewer with `scopeProjects = ['p1']` requests for
  `p2`
- **THEN** the response is `403`

### Requirement: `GET /api/projects/:project/git-log` endpoint

The web server SHALL expose
`GET /api/projects/:project/git-log?ref=<ref>&limit=<N>` with the
same auth gates as the other git endpoints.

Validation:

- `ref` MUST be present (400 if missing).
- `ref` MUST match the safe-ref character class
  `/^[A-Za-z0-9_\-/.~^]+$/` and be ≤ 200 characters (400
  otherwise).
- `limit` is optional; default is `100`. If present, MUST be a
  positive integer ≤ `1000` (400 otherwise).

Calls `readGitLog(project.root, { ref, limit })` and returns the
discriminated-union response with HTTP 200.

#### Scenario: Owner GET on `main` with default limit
- **WHEN** `GET /api/projects/<p>/git-log?ref=main`
- **THEN** the response is `200 { enabled: true, commits: [...] }`
  AND `commits.length ≤ 100`

#### Scenario: Invalid ref
- **WHEN** `GET /api/projects/<p>/git-log?ref=foo;rm%20-rf%20/`
- **THEN** the response is `400`

#### Scenario: Missing ref
- **WHEN** `GET /api/projects/<p>/git-log?limit=50`
- **THEN** the response is `400`

#### Scenario: limit out of range
- **WHEN** `GET /api/projects/<p>/git-log?ref=main&limit=99999`
- **THEN** the response is `400`

### Requirement: `GET /api/projects/:project/git-commit` endpoint

The web server SHALL expose
`GET /api/projects/:project/git-commit?sha=<x>` with the same
auth gates as the other git endpoints.

Validation:

- `sha` MUST be present (400 if missing).
- `sha` MUST match `/^[A-Za-z0-9_\-/.~^]+$/` and be ≤ 200 chars
  (400 otherwise).

Calls `readGitCommit(project.root, sha)` and returns the
discriminated-union response with HTTP 200.

#### Scenario: Owner GET for an existing commit
- **WHEN** `GET /api/projects/<p>/git-commit?sha=abc1234`
- **THEN** the response is `200 { enabled: true, sha: '...',
  subject: '...', files: [...] }`

#### Scenario: Invalid sha
- **WHEN** `GET /api/projects/<p>/git-commit?sha=../etc/passwd`
- **THEN** the response is `400`

#### Scenario: Non-existent sha returns 200 with enabled=false
- **WHEN** `GET /api/projects/<p>/git-commit?sha=deadbeefdeadbeef`
  (well-formed but no such commit)
- **THEN** the response is `200 { enabled: false, reason: 'not-
  found' }`

### Requirement: Commit list rows render a `<CommitMarkBadge />`

`<GitHistoryDialog />`'s commit-list rows SHALL render a leading
`<CommitMarkBadge />` for each commit. The badge's `mark` prop
SHALL come from the `['commit-marks', project]` TanStack query
loaded lazily once when the dialog opens.

Row layout: `[badge] [shortSha] [subject]` for the top line —
the badge sits to the LEFT of the SHA so the colored dot is the
first thing the eye lands on. The badge reserves its slot width
even for unmarked rows so rows stay vertically aligned.

#### Scenario: Marked commit shows a colored dot in the list row
- **GIVEN** the commit `abc1234…` has been marked `verified` via
  the editor
- **WHEN** the dialog opens
- **THEN** the row for `abc1234…` contains a
  `data-slot="commit-mark-badge"` element with `data-status=
  "verified"` AND an inner span with class `bg-emerald-500`

#### Scenario: Unmarked rows reserve the badge slot
- **GIVEN** zero commits are marked
- **WHEN** the dialog renders
- **THEN** every commit row contains a `data-slot="commit-mark-
  badge"` element with `data-status="none"`, so the badge slot
  is uniformly reserved

### Requirement: Selected-commit detail header renders `<CommitMarkEditor />`

`<GitHistoryDialog />`'s right pane SHALL render a
`<CommitMarkEditor />` inline with the metadata block whenever a
commit is selected. The editor receives `project`, `sha`, and the
current `mark` (or `undefined`) and MUST share the
`['commit-marks', project]` TanStack cache with the commit-list
badges so saving propagates to the list without a manual refresh.

The editor SHALL:

- Receive `mark` from the same `['commit-marks', project]`
  query.
- Wire its `onMutated` callback to invalidate the
  `['commit-marks', project]` query so the commit-list badges
  update immediately.

#### Scenario: Editor is mounted on selection
- **GIVEN** the dialog is open and the user clicks the row for
  `abc1234…`
- **WHEN** the detail pane re-renders
- **THEN** the detail header contains a `data-slot="commit-mark-
  editor"` element targeting `sha = abc1234…`

#### Scenario: Saving a mark updates the commit-list badge
- **GIVEN** the user has selected `abc1234…` (currently
  unmarked)
- **WHEN** the user picks `verified` in the editor and clicks
  Save
- **THEN** after the mutation resolves, the row for `abc1234…`
  in the commit list renders the badge with `data-status=
  "verified"` (no manual refresh needed)

### Requirement: History dialog has a submodule selector beside the branch selector

`<GitHistoryDialog />`'s toolbar SHALL render a submodule
`<Select>` (`data-slot="git-history-submodule-select"`) to the
LEFT of the existing branch select. The submodule select:

- Lists a synthetic "main" entry first (value sentinel — empty
  string), then one entry per submodule reported by
  `GET /api/projects/:project/submodules`.
- Default selection is "main".
- On change: clears `selectedRef` and `selectedSha` so the next
  render uses the new submodule's current HEAD; this also causes
  `['git-branches', project, submodule]` and `['git-log', project,
  submodule, ref]` to refetch.

The branch select continues to work, but is now keyed by
`(project, submodule)`. When the submodule has no branches (e.g.
detached-HEAD-only) the branch select still works via the
existing synthetic `(detached @ <sha>)` entry.

Refresh button invalidates `['git-branches', project, submodule]`
AND `['git-log', project, submodule, ref]` for the CURRENT
submodule scope — switching submodule is its own refetch path.

#### Scenario: Default selection is "main"
- **WHEN** the history dialog opens
- **THEN** the `data-slot="git-history-submodule-select"` element
  shows "main" as the current value

#### Scenario: Switching submodule refetches branches + log
- **GIVEN** the dialog is open showing main-repo commits
- **WHEN** the user picks submodule `vendor/foo` in the submodule
  select
- **THEN** fresh GETs to
  `/api/projects/project-a/git-branches?submodule=vendor%2Ffoo`
  AND
  `/api/projects/project-a/git-log?ref=<current>&submodule=vendor%2Ffoo`
  are fired

#### Scenario: Refresh is submodule-scoped
- **GIVEN** the dialog has the `vendor/foo` submodule selected
  and a commit list rendered
- **WHEN** the user clicks Refresh
- **THEN** only the queries for `(project, 'vendor/foo')` are
  invalidated; the main-repo queries (if cached from a previous
  selection) are NOT invalidated

#### Scenario: Selecting a commit + expanding a file inside a submodule
- **GIVEN** the user has selected the `vendor/foo` submodule,
  clicked a commit, and expanded a file row
- **WHEN** the diff fetch fires
- **THEN** the request URL is
  `/api/projects/project-a/git-diff?path=<...>&side=commit&sha=<sha>&submodule=vendor%2Ffoo`

### Requirement: Commit detail renders bump rows for submodule pointer changes

`<GitHistoryDialog />`'s commit-detail file list SHALL route file
entries through a discriminator:

- An entry is a "submodule bump" when its `submoduleBump` field
  is present AND its `path` matches a name OR path from
  `['submodules', project]`.
- Bump entries render via `<SubmoduleBumpRow />` (see
  `git-submodule-bump-diff` capability).
- All other entries render via the existing `<FileRow />` flow.

The mark editor (`<CommitMarkEditor />`) at the top of the
detail pane is UNAFFECTED by the presence of bump rows — the
mark belongs to the main-repo commit being viewed.

#### Scenario: Commit with regular files + a submodule bump renders both row variants
- **GIVEN** a main-repo commit modified `app/page.tsx` AND
  bumped the `vendor/foo` submodule
- **WHEN** the detail pane renders
- **THEN** the body contains exactly one
  `data-slot="submodule-bump-row"` element AND at least one
  `data-slot="file-row-trigger"` element; the
  `data-slot="commit-mark-editor"` is present for the
  main-repo SHA exactly as before this change

#### Scenario: Submodule path with no `submoduleBump` is still a regular FileRow
- **GIVEN** a `submoduleBump` field is absent on an entry
  (e.g. a regular tracked file whose path happens to match a
  legacy submodule name)
- **WHEN** the detail pane renders
- **THEN** the entry renders as a regular `<FileRow />`, NOT as
  a bump row — the discriminator is `submoduleBump !==
  undefined` AND a name match, both required

