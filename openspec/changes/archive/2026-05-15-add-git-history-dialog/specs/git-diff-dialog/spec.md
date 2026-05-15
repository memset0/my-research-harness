## MODIFIED Requirements

### Requirement: Footer git-pill is clickable; opens the git-diff dialog

The project-footer git-pill SHALL be wrapped in a click target that
opens a `<GitDiffDialog />` for the current project. The pill
component lives at `apps/web/components/git-status-pill.tsx`
(variant `footer`). The existing hover-tooltip behaviour SHALL be
preserved — hover shows the tooltip, click opens the dialog; the
two interactions MUST NOT block each other.

The sidebar's compact pill SHALL ALSO be clickable in this iteration
(an upgrade over the v1 contract that said it was non-clickable).
When the project's git query resolves `enabled: true`, the pill is
wrapped in a `data-slot="git-status-pill-trigger"` `<span
role="button" tabIndex={0}>` that, on click, opens the same
`<GitDiffDialog />` for that project. The wrapper MUST:

- Stop propagation on `onClick`, `onPointerDown`, and `onKeyDown`
  (Enter/Space) so the click does NOT also toggle the parent
  `CollapsibleTrigger` button that surrounds it.
- Render the click target only when the underlying git query is
  `enabled: true`. For non-git projects (or while the query is
  pending) the pill renders bare with no click affordance.
- Avoid nesting an actual `<button>` inside the parent
  CollapsibleTrigger `<button>` (invalid HTML) by using `role=
  "button" + tabIndex={0}` on a `<span>` instead.

#### Scenario: Click on footer pill opens dialog
- **WHEN** the user clicks the footer pill on `/p/project-a`
- **THEN** a shadcn `<Dialog>` opens with `data-slot="git-diff-
  dialog"` and the dialog title contains `project-a`

#### Scenario: Hover on footer pill still shows tooltip
- **WHEN** the user hovers (without clicking) the footer pill on
  `/p/project-a`
- **THEN** the Radix tooltip appears with the branch + counts +
  upstream info

#### Scenario: Click on sidebar pill opens dialog without toggling the section
- **GIVEN** the sidebar's project-a section is currently expanded
- **WHEN** the user clicks the `data-slot="git-status-pill-trigger"`
  inside the project-a row
- **THEN** a `<GitDiffDialog />` opens for `project-a` AND the
  project-a section's expansion state in `localStorage[memon:
  sidebar:expanded]` is unchanged (the click did NOT bubble to the
  enclosing CollapsibleTrigger)

#### Scenario: Sidebar pill has no click trigger for non-git project
- **GIVEN** the git query for a project resolves `enabled: false`
- **WHEN** the sidebar renders that project's row
- **THEN** no `data-slot="git-status-pill-trigger"` element exists
  in that row; the pill (which itself returns `null` for non-git
  projects) renders bare

## ADDED Requirements

### Requirement: `readGitFileContents` accepts arbitrary git refs

`readGitFileContents(cwd, ref, path, opts?)` SHALL accept ANY git
revision string as `ref` (e.g. `'<sha>'`, `'<sha>^'`, `'HEAD~3'`,
`'main'`) in addition to the existing special-cased `'index'`,
`'working'`, and `'HEAD'` values.

Behaviour:

- `ref === 'index'` — unchanged: read via `git show :<path>`.
- `ref === 'working'` — unchanged: resolve `<cwd>/<path>` with the
  path-safety check, then `fs.readFile`.
- Any other string — passed verbatim as a git revision to
  `git show <ref>:<path>` (this covers `'HEAD'`, full / short
  SHAs, parent walks via `^` / `~N`, and branch names). The cap +
  binary-detection logic from the previous spec apply unchanged.

The route layer (`/git-diff?side=commit&sha=<x>`) validates `sha`
before invoking the reader, so this widening does not introduce
new injection surface (`git show` is invoked via `execFile`, no
shell).

#### Scenario: Reading bytes at an arbitrary commit
- **GIVEN** a repo with commit `abc1234` that contains
  `app/page.tsx`
- **WHEN** `readGitFileContents(cwd, 'abc1234', 'app/page.tsx')`
  runs
- **THEN** the result is `{ ok: true, content: '<the bytes at
  abc1234:app/page.tsx, UTF-8 decoded>' }`

#### Scenario: Reading bytes at `<sha>^` (parent commit)
- **GIVEN** a repo with commit `abc1234` whose parent committed
  the same file with content `"v1\n"`
- **WHEN** `readGitFileContents(cwd, 'abc1234^', 'app/page.tsx')`
  runs
- **THEN** the result is `{ ok: true, content: 'v1\n' }`

#### Scenario: Root commit's parent returns not-found
- **GIVEN** `abc1234` is the root commit (no parent)
- **WHEN** `readGitFileContents(cwd, 'abc1234^', 'app/page.tsx')`
  runs
- **THEN** the result is `{ ok: false, reason: 'not-found' }`

### Requirement: `/git-diff` accepts `side=commit&sha=<x>`

`GET /api/projects/:project/git-diff` SHALL accept a new `side`
value `commit` alongside the existing `staged|unstaged|untracked`.
When `side=commit`, the route REQUIRES an additional `sha` query
parameter; missing `sha` MUST return 400.

`sha` validation: non-empty, length ≤ 200, and matches the
safe-ref character class `/^[A-Za-z0-9_\-/.~^]+$/`. Invalid `sha`
returns 400.

On valid input, the route resolves the diff sides as:

- `oldRef = '<sha>^'`
- `newRef = '<sha>'`

and delegates to `readGitFileContents` for each side. The
existing fallback for `not-found` on the old side (used by the
staged-add case) applies unchanged — root-commit diffs surface as
`oldContent: ''`, `status: 'added'`.

The response shape is the existing `GitDiffResponse` union — no
new fields.

#### Scenario: side=commit returns ok=true with parent vs commit contents
- **WHEN** `GET /api/projects/<p>/git-diff?path=app/page.tsx&side=
  commit&sha=abc1234`
- **THEN** the response is `200 { ok: true, oldContent: '<parent
  bytes>', newContent: '<commit bytes>', status: 'modified',
  filename: 'app/page.tsx' }`

#### Scenario: side=commit on root commit
- **GIVEN** `xyz0000` is the root commit
- **WHEN** `GET /api/projects/<p>/git-diff?path=README.md&side=
  commit&sha=xyz0000`
- **THEN** the response is `200 { ok: true, oldContent: '',
  newContent: '<file bytes at root>', status: 'added' }`

#### Scenario: side=commit missing sha
- **WHEN** `GET /api/projects/<p>/git-diff?path=app/page.tsx&
  side=commit` (no `sha`)
- **THEN** the response is `400`

#### Scenario: side=commit with malicious sha
- **WHEN** `GET /api/projects/<p>/git-diff?path=app/page.tsx&side=
  commit&sha=$(rm)`
- **THEN** the response is `400` (validation rejects before any
  reader runs)

#### Scenario: side=commit forwards too-large from either side
- **GIVEN** a commit `abc1234` that touched a 2 MB file
- **WHEN** the user requests the diff for that file at that commit
- **THEN** the response is `200 { ok: false, skipReason: 'too-
  large', sizeBytes: 2000000, maxBytes: 1048576, side: 'new' }`
  (or `side: 'old'` if the over-size side is the parent)

### Requirement: `<FileRow />` extracted for cross-dialog reuse

The collapsible file row used inside `<GitDiffDialog />` SHALL be
extracted into a module (e.g. `apps/web/components/file-row.tsx`)
and exported so `<GitHistoryDialog />` can mount the same widget
without duplication.

The row's API SHALL accept an optional `sha?: string` prop. When
provided, the row's per-file diff query is keyed by
`(project, path, side, sha)` and the underlying fetcher invokes
`fetchGitDiff(project, path, side, sha)`. When omitted, behaviour
is identical to the previous spec (staged / unstaged / untracked
without a sha).

Both call sites — `<GitDiffDialog />` and `<GitHistoryDialog />`
— SHALL use the same `<FileRow />` and `<FileDiff />`
components.

#### Scenario: FileRow without sha
- **GIVEN** `<FileRow project="p" side="unstaged" entry={...} />`
  is mounted (no `sha` prop)
- **WHEN** the user expands the row
- **THEN** the fetched URL is
  `/api/projects/p/git-diff?path=...&side=unstaged` (no `sha=`)

#### Scenario: FileRow with sha
- **GIVEN** `<FileRow project="p" side="commit" sha="abc1234"
  entry={...} />` is mounted
- **WHEN** the user expands the row
- **THEN** the fetched URL is
  `/api/projects/p/git-diff?path=...&side=commit&sha=abc1234`
